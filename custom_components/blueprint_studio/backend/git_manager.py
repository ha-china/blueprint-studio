"""Git management for Blueprint Studio."""
from __future__ import annotations

import base64
import logging
import os
import re
import shutil
import subprocess
from pathlib import Path
from typing import Any

import aiohttp
from aiohttp import web
from homeassistant.core import HomeAssistant
from homeassistant.helpers.storage import Store

from ..const import DOMAIN
from .util import json_response, json_message, is_path_safe

_LOGGER = logging.getLogger(__name__)

# GitHub OAuth Device Flow endpoints
GITHUB_DEVICE_CODE_URL = "https://github.com/login/device/code"
GITHUB_ACCESS_TOKEN_URL = "https://github.com/login/oauth/access_token"
GITHUB_CREATE_REPO_URL = "https://api.github.com/user/repos"

class GitManager:
    """Class to handle Git operations."""

    def __init__(self, hass: HomeAssistant, config_dir: Path, data: dict, store: Store) -> None:
        """Initialize Git manager."""
        self.hass = hass
        self.config_dir = config_dir
        self.data = data
        self.store = store

    def _run_git_command(self, args: list[str], auth_provider: str = "github") -> dict[str, Any]:
        """Run a git command in the config directory."""
        try:
            env = os.environ.copy()
            safe_dir_config = f"safe.directory={self.config_dir}"
            # Ignore file mode changes (permissions) which HA changes frequently
            file_mode_config = "core.fileMode=false"
            
            timeout = 30
            if any(cmd in args for cmd in ["add", "commit", "push", "pull", "clone", "fetch"]):
                timeout = 300

            needs_auth = any(cmd in args for cmd in ["push", "pull", "fetch", "clone"])
            
            # Select credentials based on provider
            creds_key = f"{auth_provider}_credentials" if auth_provider != "github" else "credentials"
            
            creds = self.data.get(creds_key, {})
            # Fallback for github
            if not creds and auth_provider == "github":
                 creds = self.data.get("github_credentials", {})

            if needs_auth and creds and "username" in creds and "token" in creds:
                username = creds["username"]
                token = base64.b64decode(creds["token"]).decode()
                helper_script = self.config_dir / f".git_credential_helper_{auth_provider}.sh"
                helper_content = f"#!/bin/sh\necho \"username={username}\"\necho \"password={token}\"\n"
                helper_script.write_text(helper_content)
                helper_script.chmod(0o700)

                result = subprocess.run(
                    ["git", "-c", safe_dir_config, "-c", file_mode_config, "-c", f"credential.helper={helper_script}"] + args,
                    cwd=self.config_dir,
                    capture_output=True,
                    text=True,
                    timeout=timeout,
                    env=env
                )
                try:
                    helper_script.unlink()
                except OSError as e:
                    _LOGGER.debug("Failed to clean up helper script: %s", e)
            else:
                result = subprocess.run(
                    ["git", "-c", safe_dir_config, "-c", file_mode_config] + args,
                    cwd=self.config_dir,
                    capture_output=True,
                    text=True,
                    timeout=timeout,
                    env=env
                )

            return {
                "success": result.returncode == 0,
                "output": result.stdout,
                "error": None if result.returncode == 0 else (result.stderr or "Git command failed")
            }
        except Exception as err:
            return {"success": False, "output": "", "error": str(err)}

    async def get_status(self, should_fetch: bool = False, remote: str = "origin", auth_provider: str = "github") -> web.Response:
        """Get git status with structured data."""
        try:
            git_dir = self.config_dir / ".git"
            is_initialized = git_dir.exists() and git_dir.is_dir()
            
            has_remote = False
            if is_initialized:
                remote_result = await self.hass.async_add_executor_job(self._run_git_command, ["remote"])
                has_remote = remote_result["success"] and remote in remote_result["output"].split()

            if is_initialized and has_remote and should_fetch:
                await self.hass.async_add_executor_job(self._run_git_command, ["fetch", remote, "--prune"], auth_provider)

            if not is_initialized:
                 return json_response({
                    "success": True, "is_initialized": False, "has_remote": False, "has_changes": False,
                    "files": {"modified": [], "added": [], "deleted": [], "untracked": [], "staged": [], "unstaged": []}
                })

            result = await self.hass.async_add_executor_job(self._run_git_command, ["status", "--porcelain"])
            if not result["success"]:
                return json_message(result["error"], status_code=500)

            full_status_result = await self.hass.async_add_executor_job(self._run_git_command, ["status"])
            full_status = full_status_result["output"] if full_status_result["success"] else ""

            status_data = {"modified": [], "added": [], "deleted": [], "untracked": [], "staged": [], "unstaged": []}
            for line in result["output"].split("\n"):
                if len(line) < 4: continue
                x_status, y_status, filename = line[0], line[1], line[3:].strip()
                if filename.startswith('"') and filename.endswith('"'): filename = filename[1:-1]
                if x_status == 'M': status_data["modified"].append(filename); status_data["staged"].append(filename)
                elif x_status == 'A': status_data["added"].append(filename); status_data["staged"].append(filename)
                elif x_status == 'D': status_data["deleted"].append(filename); status_data["staged"].append(filename)
                if y_status == 'M':
                    if filename not in status_data["modified"]:
                        status_data["modified"].append(filename)
                    status_data["unstaged"].append(filename)
                elif y_status == 'D':
                    if filename not in status_data["deleted"]:
                        status_data["deleted"].append(filename)
                    status_data["unstaged"].append(filename)
                if x_status == '?' and y_status == '?': status_data["untracked"].append(filename)

            # Sort lists for deterministic output
            for key in status_data:
                status_data[key].sort()

            has_changes = any(status_data.values())
            ahead = behind = 0
            if has_remote:
                compare_result = await self.hass.async_add_executor_job(self._run_git_command, ["rev-list", "--left-right", "--count", f"HEAD...{remote}"])
                if not compare_result["success"]:
                    branch_result = await self.hass.async_add_executor_job(self._run_git_command, ["symbolic-ref", "--short", "HEAD"])
                    current_branch = branch_result["output"].strip() if branch_result["success"] else "main"
                    compare_result = await self.hass.async_add_executor_job(self._run_git_command, ["rev-list", "--left-right", "--count", f"HEAD...{remote}/{current_branch}"])
                if compare_result["success"]:
                    try:
                        counts = compare_result["output"].strip().split()
                        if len(counts) == 2: ahead, behind = int(counts[0]), int(counts[1])
                    except ValueError: pass

            branch_result = await self.hass.async_add_executor_job(self._run_git_command, ["symbolic-ref", "--short", "HEAD"])
            current_branch = branch_result["output"].strip() if branch_result["success"] else ("HEAD" if "fatal" in str(branch_result.get("error")) else "unknown")
            all_branches_result = await self.hass.async_add_executor_job(self._run_git_command, ["branch", "--format=%(refname:short)"])
            local_branches = [b.strip() for b in all_branches_result["output"].split("\n") if b.strip()] if all_branches_result["success"] else []
            remote_branches = []
            if has_remote:
                # Use local tracking branches instead of ls-remote to avoid network delay
                rb_result = await self.hass.async_add_executor_job(self._run_git_command, ["branch", "-r"])
                if rb_result["success"]:
                    for line in rb_result["output"].split("\n"):
                        if f"{remote}/" in line:
                            branch_name = line.split(f"{remote}/")[-1].strip()
                            if branch_name and "HEAD ->" not in branch_name:
                                remote_branches.append(branch_name)

            return json_response({
                "success": True, "is_initialized": True, "has_remote": has_remote, "current_branch": current_branch,
                "local_branches": local_branches, "remote_branches": remote_branches, "ahead": ahead, "behind": behind,
                "status": full_status, "has_changes": has_changes, "files": status_data
            })
        except Exception as err:
            _LOGGER.error("Error getting git status: %s", err)
            return json_message(str(err), status_code=500)

    async def show(self, path: str) -> web.Response:
        """Get file content from HEAD."""
        try:
            if not is_path_safe(self.config_dir, path):
                 return json_message(f"Invalid path: {path}", status_code=403)
            result = await self.hass.async_add_executor_job(self._run_git_command, ["show", f"HEAD:{path}"])
            if result["success"]:
                return json_response({"success": True, "content": result["output"]})
            return json_message(result["error"], status_code=500)
        except Exception as err:
            _LOGGER.error("Error showing git file: %s", err)
            return json_message(str(err), status_code=500)

    async def pull(self, remote: str = "origin", auth_provider: str = "github") -> web.Response:
        """Pull changes from git remote."""
        try:
            branch_result = await self.hass.async_add_executor_job(self._run_git_command, ["symbolic-ref", "--short", "HEAD"])
            target_branch = branch_result["output"].strip() if branch_result["success"] else None
            if not target_branch:
                remote_head = await self.hass.async_add_executor_job(self._run_git_command, ["remote", "show", remote], auth_provider)
                if remote_head["success"]:
                    match = re.search(r"HEAD branch: (.+)", remote_head["output"])
                    if match: target_branch = match.group(1).strip()
            if not target_branch: target_branch = "main"
            result = await self.hass.async_add_executor_job(self._run_git_command, ["pull", "--rebase", remote, target_branch], auth_provider)
            if result["success"]:
                return json_response({"success": True, "output": result["output"]})
            return json_message(result["error"], status_code=500)
        except Exception as err:
            _LOGGER.error("Error pulling from git: %s", err)
            return json_message(str(err), status_code=500)

    async def commit(self, commit_message: str) -> web.Response:
        """Commit changes to git."""
        try:
            commit_result = await self.hass.async_add_executor_job(self._run_git_command, ["commit", "-m", commit_message])
            if commit_result["success"]:
                return json_response({"success": True, "output": commit_result["output"]})
            return json_message(commit_result["error"], status_code=500)
        except Exception as err:
            _LOGGER.error("Error committing to git: %s", err)
            return json_message(str(err), status_code=500)

    async def push(self, commit_message: str, remote: str = "origin", auth_provider: str = "github") -> web.Response:
        """Commit and push changes to git remote."""
        try:
            git_dir = self.config_dir / ".git"
            if not git_dir.exists():
                return json_message("Git repository not initialized.", status_code=400)
            check_commits = await self.hass.async_add_executor_job(self._run_git_command, ["rev-parse", "HEAD"])
            has_commits = check_commits["success"]
            if not has_commits:
                # If no commits at all, we might need a first commit
                # But we should still only commit what is staged
                commit_result = await self.commit(commit_message)
            else:
                status_result = await self.hass.async_add_executor_job(self._run_git_command, ["status", "--porcelain"])
                # Only commit if there are STAGED changes
                if status_result["success"]:
                    has_staged = any(line.strip() and line[0] in "MADR" for line in status_result["output"].split("\n"))
                    if has_staged:
                        await self.commit(commit_message)

            branch_result = await self.hass.async_add_executor_job(self._run_git_command, ["symbolic-ref", "--short", "HEAD"])
            target_branch = branch_result["output"].strip() if branch_result["success"] else "main"
            push_result = await self.hass.async_add_executor_job(self._run_git_command, ["push", "-u", remote, f"HEAD:refs/heads/{target_branch}"], auth_provider)
            if push_result["success"]:
                return json_response({"success": True, "output": push_result["output"]})
            return json_message(push_result["error"], status_code=500)
        except Exception as err:
            _LOGGER.error("Error pushing to git: %s", err)
            return json_message(str(err), status_code=500)

    async def push_only(self, remote: str = "origin", auth_provider: str = "github") -> web.Response:
        """Push existing commits to remote without committing first."""
        try:
            git_dir = self.config_dir / ".git"
            if not git_dir.exists(): return json_message("Git repo not initialized.", status_code=400)
            check_commits = await self.hass.async_add_executor_job(self._run_git_command, ["rev-parse", "HEAD"])
            if not check_commits["success"]: return json_message("No commits to push.", status_code=400)
            
            branch_result = await self.hass.async_add_executor_job(self._run_git_command, ["symbolic-ref", "--short", "HEAD"])
            target_branch = branch_result["output"].strip() if branch_result["success"] else "main"
            push_result = await self.hass.async_add_executor_job(self._run_git_command, ["push", "-u", remote, f"HEAD:refs/heads/{target_branch}"], auth_provider)
            if push_result["success"]:
                return json_response({"success": True, "message": "Successfully pushed", "output": push_result["output"]})
            return json_message(f"Push failed: {push_result['error']}", status_code=500)
        except Exception as err:
            _LOGGER.error("Error pushing to git: %s", err)
            return json_message(str(err), status_code=500)

    async def init(self) -> web.Response:
        """Initialize a git repository."""
        try:
            git_dir = self.config_dir / ".git"
            exists = git_dir.exists()
            result = await self.hass.async_add_executor_job(self._run_git_command, ["init", "-b", "main"])
            if not result["success"]:
                result = await self.hass.async_add_executor_job(self._run_git_command, ["init"])
                if result["success"] and not exists:
                    branch_check = await self.hass.async_add_executor_job(self._run_git_command, ["symbolic-ref", "--short", "HEAD"])
                    if branch_check["success"] and branch_check["output"].strip() == "master":
                        await self.hass.async_add_executor_job(self._run_git_command, ["branch", "-m", "main"])
            if result["success"]:
                await self._create_gitignore_if_missing()
                return json_response({"success": True, "message": "Git repository initialized", "output": result["output"]})
            return json_message(result["error"], status_code=500)
        except Exception as err:
            _LOGGER.error("Error initializing git: %s", err)
            return json_message(str(err), status_code=500)

    async def _create_gitignore_if_missing(self) -> None:
        """Create a .gitignore file if it doesn't exist."""
        try:
            gitignore_path = self.config_dir / ".gitignore"
            if not gitignore_path.exists():
                gitignore_content = "# Home Assistant - Git Ignore File\n*.db\n*.log\n.storage/\n.cloud/\n__pycache__/\n.vscode/\n.git_credential_helper*.sh\n"
                await self.hass.async_add_executor_job(gitignore_path.write_text, gitignore_content)
        except Exception as err:
            _LOGGER.warning("Failed to create .gitignore: %s", err)

    async def add_remote(self, name: str, url: str) -> web.Response:
        """Add or update a git remote."""
        try:
            check_result = await self.hass.async_add_executor_job(self._run_git_command, ["remote", "get-url", name])
            if check_result["success"]:
                result = await self.hass.async_add_executor_job(self._run_git_command, ["remote", "set-url", name, url])
                message = f"Remote '{name}' updated"
            else:
                result = await self.hass.async_add_executor_job(self._run_git_command, ["remote", "add", name, url])
                message = f"Remote '{name}' added"
            if result["success"]:
                return json_response({"success": True, "message": message, "output": result["output"]})
            return json_message(result["error"], status_code=500)
        except Exception as err:
            _LOGGER.error("Error adding/updating remote: %s", err)
            return json_message(str(err), status_code=500)

    async def remove_remote(self, name: str) -> web.Response:
        """Remove a git remote."""
        try:
            result = await self.hass.async_add_executor_job(self._run_git_command, ["remote", "remove", name])
            if result["success"]:
                return json_response({"success": True, "message": f"Remote '{name}' removed", "output": result["output"]})
            return json_message(result["error"], status_code=500)
        except Exception as err:
            _LOGGER.error("Error removing remote: %s", err)
            return json_message(str(err), status_code=500)

    async def delete_repo(self) -> web.Response:
        """Delete the .git directory (destroy repo)."""
        try:
            git_dir = self.config_dir / ".git"
            if git_dir.exists() and git_dir.is_dir():
                await self.hass.async_add_executor_job(shutil.rmtree, git_dir)
                return json_response({"success": True, "message": "Git repository deleted"})
            return json_response({"success": True, "message": "No Git repository found"})
        except Exception as err:
            _LOGGER.error("Error deleting repo: %s", err)
            return json_message(str(err), status_code=500)

    async def repair_index(self) -> web.Response:
        """Repair a corrupted git index."""
        try:
            index_file = self.config_dir / ".git" / "index"
            if index_file.exists(): await self.hass.async_add_executor_job(index_file.unlink)
            await self.hass.async_add_executor_job(self._run_git_command, ["reset"])
            return json_response({"success": True, "message": "Git index repaired"})
        except Exception as err:
            _LOGGER.error("Error repairing git index: %s", err)
            return json_message(str(err), status_code=500)

    async def github_create_repo(self, repo_name: str, description: str, is_private: bool) -> web.Response:
        """Create a new GitHub repository."""
        try:
            if not repo_name: return json_message("Repository name is required", status_code=400)
            creds = self.data.get("github_credentials", {})
            if not creds or "token" not in creds: return json_message("Not authenticated.", status_code=401)
            token = base64.b64decode(creds["token"]).decode()
            async with aiohttp.ClientSession() as session:
                async with session.post(GITHUB_CREATE_REPO_URL, json={"name": repo_name, "description": description, "private": is_private, "auto_init": False}, headers={"Authorization": f"Bearer {token}", "Accept": "application/vnd.github+json", "X-GitHub-Api-Version": "2022-11-28"}) as response:
                    if response.status == 201:
                        repo_data = await response.json()
                        await self.init()
                        await self.add_remote("origin", repo_data.get("clone_url"))
                        return json_response({"success": True, "message": f"Repository '{repo_name}' created successfully", "html_url": repo_data.get("html_url"), "clone_url": repo_data.get("clone_url"), "username": creds.get("username", "")})
                    else:
                        error_text = await response.text()
                        return json_message(f"Failed to create repository: {error_text}", status_code=response.status)
        except Exception as err:
            _LOGGER.error("Error creating GitHub repo: %s", err)
            return json_message(str(err), status_code=500)

    async def github_set_default_branch(self, branch: str) -> web.Response:
        """Set the default branch for the GitHub repository."""
        try:
            remotes_result = await self.hass.async_add_executor_job(self._run_git_command, ["remote", "get-url", "origin"])
            if not remotes_result["success"]: return json_message("Origin remote not found", status_code=400)
            url = remotes_result["output"].strip()
            match = re.search(r"github\.com[:/](.+?)/(.+?)(\.git)?$", url)
            if not match: return json_message(f"Could not parse GitHub owner/repo from URL", status_code=400)
            owner, repo = match.group(1), match.group(2)
            creds = self.data.get("github_credentials", {})
            if not creds or "token" not in creds: return json_message("Not authenticated", status_code=401)
            token = base64.b64decode(creds["token"]).decode()
            api_url = f"https://api.github.com/repos/{owner}/{repo}"
            async with aiohttp.ClientSession() as session:
                async with session.patch(api_url, json={"default_branch": branch}, headers={"Authorization": f"Bearer {token}", "Accept": "application/vnd.github+json", "X-GitHub-Api-Version": "2022-11-28"}) as response:
                    if response.status == 200: return json_response({"success": True, "message": f"Default branch set to '{branch}'"})
                    else: return json_message(f"GitHub error: {await response.text()}", status_code=response.status)
        except Exception as err:
            _LOGGER.error("Error setting default branch: %s", err)
            return json_message(str(err), status_code=500)

    async def get_remotes(self) -> web.Response:
        """Get list of configured git remotes."""
        try:
            result = await self.hass.async_add_executor_job(self._run_git_command, ["remote", "-v"])
            if result["success"]:
                remotes = {}
                for line in result["output"].split("\n"):
                    parts = line.split()
                    if len(parts) >= 2:
                        if parts[0] not in remotes: remotes[parts[0]] = parts[1]
                return json_response({"success": True, "remotes": remotes})
            return json_message(result["error"], status_code=500)
        except Exception as err:
            _LOGGER.error("Error getting remotes: %s", err)
            return json_message(str(err), status_code=500)

    def get_credentials(self, provider: str = "github") -> web.Response:
        """Get saved git credentials."""
        creds_key = f"{provider}_credentials" if provider != "github" else "credentials"
        creds = self.data.get(creds_key, {})
        # Fallback check
        if not creds and provider == "github":
             creds = self.data.get("github_credentials", {})
        return json_response({"success": True, "has_credentials": "username" in creds, "username": creds.get("username", "")})

    async def set_credentials(self, username: str, token: str, remember_me: bool = True, provider: str = "github") -> web.Response:
        """Set git credentials."""
        try:
            await self.hass.async_add_executor_job(self._run_git_command, ["config", "credential.helper", "store"])
            
            creds_key = f"{provider}_credentials"
            if provider == "github":
                pass 
            
            if remember_me:
                self.data[creds_key] = {"username": username, "token": base64.b64encode(token.encode()).decode()}
                # Clean up legacy key if setting github
                if provider == "github" and "credentials" in self.data:
                    del self.data["credentials"]
                
                await self.store.async_save(self.data)
            elif creds_key in self.data:
                del self.data[creds_key]
                if provider == "github" and "credentials" in self.data:
                    del self.data["credentials"]
                await self.store.async_save(self.data)
            
            if DOMAIN not in self.hass.data: self.hass.data[DOMAIN] = {}
            if "git_credentials" not in self.hass.data[DOMAIN]: self.hass.data[DOMAIN]["git_credentials"] = {}
            
            # Store in memory by provider
            self.hass.data[DOMAIN]["git_credentials"][provider] = {"username": username, "token": token}
            
            await self.hass.async_add_executor_job(self._run_git_command, ["config", "user.name", username])
            # Default email logic
            email_host = "users.noreply.github.com" if provider == "github" else "localhost" 
            await self.hass.async_add_executor_job(self._run_git_command, ["config", "user.email", f"{username}@{email_host}"])
            return json_response({"success": True, "message": "Git credentials saved"})
        except Exception as err:
            _LOGGER.error("Error setting credentials: %s", err)
            return json_message(str(err), status_code=500)

    async def clear_credentials(self, provider: str = "github") -> web.Response:
        """Clear git credentials and sign out."""
        try:
            creds_key = f"{provider}_credentials"
            if creds_key in self.data: del self.data[creds_key]
            if provider == "github" and "credentials" in self.data: del self.data["credentials"]
            
            await self.store.async_save(self.data)
            
            if DOMAIN in self.hass.data and "git_credentials" in self.hass.data[DOMAIN]:
                if provider in self.hass.data[DOMAIN]["git_credentials"]:
                    del self.hass.data[DOMAIN]["git_credentials"][provider]
            
            await self.hass.async_add_executor_job(self._run_git_command, ["config", "--unset", "credential.helper"])
            return json_response({"success": True, "message": "Successfully signed out"})
        except Exception as err:
            _LOGGER.error("Error clearing credentials: %s", err)
            return json_message(str(err), status_code=500)

    async def test_connection(self, remote: str = "origin", auth_provider: str = "github") -> web.Response:
        """Test connection to git remote."""
        try:
            result = await self.hass.async_add_executor_job(self._run_git_command, ["ls-remote", "--exit-code", remote], auth_provider)
            if result["success"]: return json_response({"success": True, "message": "Connection successful"})
            return json_response({"success": False, "message": "Connection failed", "error": result["error"]}, status_code=400)
        except Exception as err:
            _LOGGER.error("Error testing connection: %s", err)
            return json_message(str(err), status_code=500)

    async def github_device_flow_start(self, client_id: str) -> web.Response:
        """Start GitHub OAuth Device Flow."""
        try:
            async with aiohttp.ClientSession() as session:
                async with session.post(GITHUB_DEVICE_CODE_URL, data={"client_id": client_id, "scope": "repo"}, headers={"Accept": "application/json"}) as response:
                    if response.status != 200: return json_message(f"Failed to start device flow", status_code=response.status)
                    data = await response.json()
                    if "error" in data: return json_message(data.get('error_description', 'Unknown error'), status_code=400)
                    return json_response({"success": True, "device_code": data.get("device_code"), "user_code": data.get("user_code"), "verification_uri": data.get("verification_uri"), "expires_in": data.get("expires_in"), "interval": data.get("interval", 5)})
        except Exception as err:
            _LOGGER.error("Error starting device flow: %s", err)
            return json_message(str(err), status_code=500)

    async def github_device_flow_poll(self, client_id: str, device_code: str) -> web.Response:
        """Poll for GitHub OAuth Device Flow authorization."""
        try:
            async with aiohttp.ClientSession() as session:
                async with session.post(GITHUB_ACCESS_TOKEN_URL, data={"client_id": client_id, "device_code": device_code, "grant_type": "urn:ietf:params:oauth:grant-type:device_code"}, headers={"Accept": "application/json"}) as response:
                    data = await response.json()
                    if "error" in data:
                        error_code = data["error"]
                        status = "pending" if error_code == "authorization_pending" else "slow_down" if error_code == "slow_down" else "error"
                        return json_response({"success": False, "status": status, "message": data.get("error_description", "Unknown error")})
                    access_token = data.get("access_token")
                    async with session.get("https://api.openai.com/user" if "openai" in str(access_token) else "https://api.github.com/user", headers={"Authorization": f"Bearer {access_token}", "Accept": "application/json"}) as user_response:
                        if user_response.status == 200:
                            user_data = await user_response.json()
                            await self.set_credentials(user_data.get("login"), access_token)
                            return json_response({"success": True, "status": "authorized", "username": user_data.get("login"), "message": "Successfully authenticated"})
                        return json_message("Failed to get user info", status_code=user_response.status)
        except Exception as err:
            _LOGGER.error("Error polling device flow: %s", err)
            return json_message(str(err), status_code=500)

    async def github_star(self) -> web.Response:
        """Star the repository on behalf of the user."""
        try:
            creds = self.data.get("github_credentials", {})
            if not creds or "token" not in creds: return json_message("Not authenticated with GitHub", status_code=401)
            token = base64.b64decode(creds["token"]).decode()
            url = "https://api.github.com/user/starred/ha-china/blueprint-studio"
            async with aiohttp.ClientSession() as session:
                async with session.put(url, headers={"Authorization": f"Bearer {token}", "Content-Length": "0", "Accept": "application/vnd.github+json"}) as response:
                    if response.status == 204: return json_response({"success": True, "message": "Repository starred!"})
                    return json_message(f"GitHub Error: {response.status}", status_code=response.status)
        except Exception as e: return json_message(str(e), status_code=500)

    async def github_follow(self) -> web.Response:
        """Follow the author on behalf of the user."""
        try:
            creds = self.data.get("github_credentials", {})
            if not creds or "token" not in creds: return json_message("Not authenticated with GitHub", status_code=401)
            token = base64.b64decode(creds["token"]).decode()
            url = "https://api.github.com/user/following/soulripper13"
            async with aiohttp.ClientSession() as session:
                async with session.put(url, headers={"Authorization": f"Bearer {token}", "Content-Length": "0", "Accept": "application/vnd.github+json"}) as response:
                    if response.status == 204: return json_response({"success": True, "message": "Now following soulripper13!"})
                    return json_message(f"GitHub Error: {response.status}", status_code=response.status)
        except Exception as e: return json_message(str(e), status_code=500)

    async def gitea_create_repo(self, repo_name: str, description: str, is_private: bool, gitea_url: str) -> web.Response:
        """Create a new Gitea repository."""
        try:
            if not repo_name: return json_message("Repository name is required", status_code=400)
            if not gitea_url: return json_message("Gitea server URL is required", status_code=400)

            # Get Gitea credentials
            creds = self.data.get("gitea_credentials", {})
            if not creds or "token" not in creds: return json_message("Not authenticated with Gitea.", status_code=401)
            token = base64.b64decode(creds["token"]).decode()

            # Normalize Gitea URL (remove trailing slash)
            gitea_url = gitea_url.rstrip('/')

            # Gitea API endpoint for creating repos
            create_url = f"{gitea_url}/api/v1/user/repos"

            async with aiohttp.ClientSession() as session:
                async with session.post(
                    create_url,
                    json={
                        "name": repo_name,
                        "description": description,
                        "private": is_private,
                        "auto_init": False
                    },
                    headers={
                        "Authorization": f"token {token}",
                        "Content-Type": "application/json"
                    }
                ) as response:
                    if response.status == 201:
                        repo_data = await response.json()
                        # Initialize git if not already done
                        await self.init()
                        # Add Gitea remote
                        clone_url = repo_data.get("clone_url")
                        if clone_url:
                            await self.add_remote("gitea", clone_url)
                        return json_response({
                            "success": True,
                            "message": f"Repository '{repo_name}' created successfully on Gitea",
                            "html_url": repo_data.get("html_url"),
                            "clone_url": clone_url,
                            "username": creds.get("username", "")
                        })
                    else:
                        error_text = await response.text()
                        _LOGGER.error(f"Gitea API error ({response.status}): {error_text}")
                        return json_message(f"Failed to create repository: {error_text}", status_code=response.status)
        except Exception as err:
            _LOGGER.error("Error creating Gitea repo: %s", err)
            return json_message(str(err), status_code=500)

    async def stage(self, files: list[str]) -> web.Response:
        """Stage specific files."""
        try:
            for file in files:
                if not is_path_safe(self.config_dir, file): return json_message(f"Invalid path: {file}", status_code=403)
            result = await self.hass.async_add_executor_job(self._run_git_command, ["add"] + files)
            if result["success"]: return json_response({"success": True, "message": f"Staged {len(files)} file(s)", "output": result["output"]})
            return json_message(result["error"], status_code=500)
        except Exception as err:
            _LOGGER.error("Error staging files: %s", err)
            return json_message(str(err), status_code=500)

    async def unstage(self, files: list[str]) -> web.Response:
        """Unstage specific files."""
        try:
            for file in files:
                if not is_path_safe(self.config_dir, file): return json_message(f"Invalid path: {file}", status_code=403)
            result = await self.hass.async_add_executor_job(self._run_git_command, ["reset"] + files)
            if result["success"]: return json_response({"success": True, "message": f"Unstaged {len(files)} file(s)", "output": result["output"]})
            return json_message(result["error"], status_code=500)
        except Exception as err:
            _LOGGER.error("Error unstaging files: %s", err)
            return json_message(str(err), status_code=500)

    async def reset(self, files: list[str]) -> web.Response:
        """Reset/discard changes to specific files."""
        try:
            for file in files:
                if not is_path_safe(self.config_dir, file): return json_message(f"Invalid path: {file}", status_code=403)
            result = await self.hass.async_add_executor_job(self._run_git_command, ["checkout", "HEAD", "--"] + files)
            if result["success"]: return json_response({"success": True, "message": f"Reset {len(files)} file(s)", "output": result["output"]})
            return json_message(result["error"], status_code=500)
        except Exception as err:
            _LOGGER.error("Error resetting files: %s", err)
            return json_message(str(err), status_code=500)

    async def abort(self) -> web.Response:
        """Abort a rebase or merge operation."""
        try:
            rebase_result = await self.hass.async_add_executor_job(self._run_git_command, ["rebase", "--abort"])
            merge_result = await self.hass.async_add_executor_job(self._run_git_command, ["merge", "--abort"])
            if rebase_result["success"] or merge_result["success"]:
                return json_response({"success": True, "message": "Git operation aborted successfully"})
            reset_result = await self.hass.async_add_executor_job(self._run_git_command, ["reset", "--merge"])
            if reset_result["success"]: return json_response({"success": True, "message": "Sync reset successfully"})
            return json_message("Failed to abort git operation", status_code=500)
        except Exception as err:
            _LOGGER.error("Error aborting git operation: %s", err)
            return json_message(str(err), status_code=500)

    async def stop_tracking(self, files: list[str]) -> web.Response:
        """Stop tracking specific files."""
        try:
            for file in files:
                if not is_path_safe(self.config_dir, file): return json_message(f"Invalid path: {file}", status_code=403)
                await self.hass.async_add_executor_job(self._run_git_command, ["rm", "-r", "--cached", file])
            return json_response({"success": True})
        except Exception as err:
            _LOGGER.error("Error stopping tracking for files: %s", err)
            return json_message(str(err), status_code=500)

    async def clean_locks(self) -> web.Response:
        """Clean Git lock files."""
        try:
            git_dir = self.config_dir / ".git"
            lock_files = [git_dir / "index.lock", git_dir / "HEAD.lock", git_dir / "refs" / "heads" / "master.lock", git_dir / "refs" / "heads" / "main.lock"]
            state_dirs = [git_dir / "rebase-merge", git_dir / "rebase-apply", git_dir / "MERGE_HEAD", git_dir / "CHERRY_PICK_HEAD", git_dir / "REVERT_HEAD"]
            removed = []
            for lock_file in lock_files:
                if lock_file.exists():
                    await self.hass.async_add_executor_job(lock_file.unlink)
                    removed.append(str(lock_file.relative_to(self.config_dir)))
            for state_dir in state_dirs:
                if state_dir.exists():
                    if state_dir.is_dir(): await self.hass.async_add_executor_job(shutil.rmtree, state_dir)
                    else: await self.hass.async_add_executor_job(state_dir.unlink)
                    removed.append(str(state_dir.relative_to(self.config_dir)))
            return json_response({"success": True, "message": f"Removed {len(removed)} lock file(s)", "removed": removed})
        except Exception as err:
            _LOGGER.error("Error cleaning Git locks: %s", err)
            return json_message(str(err), status_code=500)

    async def rename_branch(self, old_name: str, new_name: str) -> web.Response:
        """Rename a git branch."""
        try:
            branch_result = await self.hass.async_add_executor_job(self._run_git_command, ["symbolic-ref", "--short", "HEAD"])
            current = branch_result["output"].strip() if branch_result["success"] else None
            if current == old_name: result = await self.hass.async_add_executor_job(self._run_git_command, ["branch", "-m", new_name])
            else: result = await self.hass.async_add_executor_job(self._run_git_command, ["branch", "-m", old_name, new_name])
            if result["success"]: return json_response({"success": True, "message": f"Branch renamed from {old_name} to {new_name}"})
            return json_message(result["error"], status_code=500)
        except Exception as err:
            _LOGGER.error("Error renaming branch: %s", err)
            return json_message(str(err), status_code=500)

    async def merge_unrelated(self, remote: str, branch: str) -> web.Response:
        """Merge a remote branch with unrelated histories."""
        try:
            result = await self.hass.async_add_executor_job(self._run_git_command, ["merge", f"{remote}/{branch}", "--allow-unrelated-histories", "-m", "Merge unrelated histories"])
            if result["success"]: return json_response({"success": True, "message": "Merged unrelated histories successfully"})
            return json_message(result["error"], status_code=500)
        except Exception as err:
            _LOGGER.error("Error merging unrelated histories: %s", err)
            return json_message(str(err), status_code=500)

    async def force_push(self, remote: str = "origin", auth_provider: str = "github") -> web.Response:
        """Force push local branch to remote."""
        try:
            branch_result = await self.hass.async_add_executor_job(self._run_git_command, ["symbolic-ref", "--short", "HEAD"])
            current = branch_result["output"].strip() if branch_result["success"] else "main"
            result = await self.hass.async_add_executor_job(self._run_git_command, ["push", "-f", remote, current], auth_provider)
            if result["success"]: return json_response({"success": True, "message": f"Force pushed to {current} on {remote} successfully"})
            return json_message(result["error"], status_code=500)
        except Exception as err:
            _LOGGER.error("Error force pushing: %s", err)
            return json_message(str(err), status_code=500)

    async def hard_reset(self, remote: str, branch: str, auth_provider: str = "github") -> web.Response:
        """Hard reset local branch to match remote exactly."""
        try:
            await self.hass.async_add_executor_job(self._run_git_command, ["fetch", remote], auth_provider)
            result = await self.hass.async_add_executor_job(self._run_git_command, ["reset", "--hard", f"{remote}/{branch}"])
            if result["success"]: return json_response({"success": True, "message": f"Hard reset to {remote}/{branch} successful"})
            return json_message(result["error"], status_code=500)
        except Exception as err:
            _LOGGER.error("Error hard resetting: %s", err)
            return json_message(str(err), status_code=500)

    async def checkout_branch(self, branch: str) -> web.Response:
        """Switch to an existing local branch."""
        try:
            result = await self.hass.async_add_executor_job(self._run_git_command, ["checkout", branch])
            if result["success"]:
                return json_response({"success": True, "message": f"Switched to branch '{branch}'"})
            return json_message(result["error"], status_code=500)
        except Exception as err:
            _LOGGER.error("Error checking out branch: %s", err)
            return json_message(str(err), status_code=500)

    async def create_branch(self, name: str, checkout: bool = True) -> web.Response:
        """Create a new branch from current HEAD, optionally switch to it."""
        try:
            if not name or not name.strip():
                return json_message("Branch name is required", status_code=400)
            args = ["checkout", "-b", name] if checkout else ["branch", name]
            result = await self.hass.async_add_executor_job(self._run_git_command, args)
            if result["success"]:
                return json_response({"success": True, "message": f"Branch '{name}' created"})
            return json_message(result["error"], status_code=500)
        except Exception as err:
            _LOGGER.error("Error creating branch: %s", err)
            return json_message(str(err), status_code=500)

    async def delete_local_branch(self, branch: str, force: bool = False) -> web.Response:
        """Delete a local branch."""
        try:
            flag = "-D" if force else "-d"
            result = await self.hass.async_add_executor_job(self._run_git_command, ["branch", flag, branch])
            if result["success"]:
                return json_response({"success": True, "message": f"Branch '{branch}' deleted"})
            return json_message(result["error"], status_code=500)
        except Exception as err:
            _LOGGER.error("Error deleting local branch: %s", err)
            return json_message(str(err), status_code=500)

    async def merge_branch(self, branch: str) -> web.Response:
        """Merge a branch into the current branch."""
        try:
            result = await self.hass.async_add_executor_job(self._run_git_command, ["merge", branch, "--no-edit"])
            if result["success"]:
                return json_response({"success": True, "message": f"Merged '{branch}' into current branch", "output": result["output"]})
            return json_message(result["error"], status_code=500)
        except Exception as err:
            _LOGGER.error("Error merging branch: %s", err)
            return json_message(str(err), status_code=500)

    async def get_conflict_files(self) -> web.Response:
        """Get list of files with merge conflicts."""
        try:
            result = await self.hass.async_add_executor_job(self._run_git_command, ["diff", "--name-only", "--diff-filter=U"])
            if result["success"]:
                files = [f.strip() for f in result["output"].split("\n") if f.strip()]
                return json_response({"success": True, "conflict_files": files})
            return json_message(result["error"], status_code=500)
        except Exception as err:
            _LOGGER.error("Error getting conflict files: %s", err)
            return json_message(str(err), status_code=500)

    async def resolve_conflict(self, path: str, resolution: str) -> web.Response:
        """Resolve a merge conflict by accepting 'ours' or 'theirs'."""
        try:
            if not is_path_safe(self.config_dir, path):
                return json_message(f"Invalid path: {path}", status_code=403)
            if resolution == "ours":
                result = await self.hass.async_add_executor_job(self._run_git_command, ["checkout", "--ours", path])
            elif resolution == "theirs":
                result = await self.hass.async_add_executor_job(self._run_git_command, ["checkout", "--theirs", path])
            else:
                return json_message("Resolution must be 'ours' or 'theirs'", status_code=400)
            if result["success"]:
                await self.hass.async_add_executor_job(self._run_git_command, ["add", path])
                return json_response({"success": True, "message": f"Resolved conflict in '{path}' using {resolution}"})
            return json_message(result["error"], status_code=500)
        except Exception as err:
            _LOGGER.error("Error resolving conflict: %s", err)
            return json_message(str(err), status_code=500)

    async def delete_remote_branch(self, branch: str) -> web.Response:
        """Delete a branch on the remote repository."""
        try:
            if branch in ["main", "master"]:
                branch_result = await self.hass.async_add_executor_job(self._run_git_command, ["symbolic-ref", "--short", "HEAD"])
                if branch_result["success"] and branch_result["output"].strip() == branch:
                    return json_message(f"Cannot delete your current active branch '{branch}'", status_code=400)
            result = await self.hass.async_add_executor_job(self._run_git_command, ["push", "origin", "--delete", branch])
            if result["success"]: return json_response({"success": True, "message": f"Branch '{branch}' deleted from GitHub"})
            return json_message(result["error"], status_code=500)
        except Exception as err:
            _LOGGER.error("Error deleting remote branch: %s", err)
            return json_message(str(err), status_code=500)

    async def get_log(self, count: int = 20) -> web.Response:
        """Get recent git commits."""
        try:
            result = await self.hass.async_add_executor_job(self._run_git_command, ["log", f"--pretty=format:%H|%at|%an|%s", f"-n", str(count)])
            if not result["success"]:
                if "does not have any commits" in str(result.get("error")) or "fatal: your current branch" in str(result.get("error")):
                    return json_response({"success": True, "commits": []})
                return json_message(result["error"], status_code=500)
            commits = []
            for line in result["output"].split("\n"):
                if not line.strip(): continue
                parts = line.split("|", 3)
                if len(parts) == 4: commits.append({"hash": parts[0], "timestamp": int(parts[1]), "author": parts[2], "message": parts[3]})
            return json_response({"success": True, "commits": commits})
        except Exception as err:
            _LOGGER.error("Error getting git log: %s", err)
            return json_message(str(err), status_code=500)

    async def diff_commit(self, commit_hash: str) -> web.Response:
        """Get the diff for a specific commit."""
        try:
            result = await self.hass.async_add_executor_job(self._run_git_command, ["show", "--pretty=format:", commit_hash])
            if result["success"]: return json_response({"success": True, "diff": result["output"]})
            return json_message(result["error"], status_code=500)
        except Exception as err:
            _LOGGER.error("Error getting git diff for commit: %s", err)
            return json_message(str(err), status_code=500)
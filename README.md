# Blueprint Studio for Home Assistant 🚀

[![HACS Default](https://img.shields.io/badge/HACS-Default-orange.svg?style=for-the-badge)](https://github.com/hacs/default)
[![GitHub Release](https://img.shields.io/github/release/ha-china/blueprint-studio.svg?style=for-the-badge)](https://github.com/ha-china/blueprint-studio/releases)
[![GitHub License](https://img.shields.io/badge/License-MIT-green.svg?style=for-the-badge)](LICENSE)
[![GitHub Issues](https://img.shields.io/github/issues/ha-china/blueprint-studio.svg?style=for-the-badge)](https://github.com/ha-china/blueprint-studio/issues)
[![GitHub Stars](https://img.shields.io/badge/Stars-94-blue.svg?style=for-the-badge&logo=github)](https://github.com/ha-china/blueprint-studio/stargazers)
![Home Assistant](https://img.shields.io/badge/Home%20Assistant-2024.4.0%2B-blue.svg?style=for-the-badge)
![Maintenance](https://img.shields.io/maintenance/yes/2026.svg?style=for-the-badge)
![Downloads](https://img.shields.io/badge/dynamic/json?color=41BDF5&logo=home-assistant&label=Downloads&suffix=%20installs&cacheSeconds=15600&style=for-the-badge&url=https://analytics.home-assistant.io/custom_integrations.json&query=$.blueprint_studio.total)
[![Support Development](https://img.shields.io/badge/Support-Development-FF5E5B?style=for-the-badge&logo=ko-fi&logoColor=white)](https://ko-fi.com/soulripper13)
[![Support via PayPal](https://img.shields.io/badge/Support-PayPal-00457C?style=for-the-badge&logo=paypal&logoColor=white)](https://paypal.me/SKatoaroo)

<div align="center">
  <img src="https://dummyimage.com/800x60/0d1117/ffffff&text=Blueprint+Studio+-+Edit+Your+HA+Configs+Like+a+Pro" alt="Hero Banner">
  <br><br>
  <img src="icon.png" alt="Logo" width="120">
  <h3>Blueprint Studio for Home Assistant</h3>
  <p>A modern, feature-rich file editor with AI-powered assistance and full Git integration.</p>
  
  <a href="https://my.home-assistant.io/redirect/hacs_repository/?owner=ha-china&repository=blueprint-studio&category=integration">
    <img src="https://my.home-assistant.io/badges/hacs_repository.svg" alt="Open in HACS">
  </a>
  <a href="https://my.home-assistant.io/redirect/config_flow_start/?domain=blueprint_studio">
    <img src="https://my.home-assistant.io/badges/config_flow_start.svg" alt="Add Integration">
  </a>
</div>

---

## 📖 Table of Contents
- [Why Blueprint Studio? 🌟](#why-blueprint-studio-)
- [Screenshots 📸](#screenshots-)
- [✨ Features](#-features)
- [🔧 Installation](#-installation)
- [⚙️ Configuration](#️-configuration)
- [🚀 Usage](#-usage)
- [📄 Supported File Types](#-supported-file-types)
- [🔒 Security](#-security)
- [🛠️ Troubleshooting](#️-troubleshooting)
- [❓ FAQ](#-faq)
- [🔍 Technical Details](#-technical-details)
- [🤝 Contributing](#-contributing)
- [🗺️ Roadmap](#️-roadmap)
- [📞 Support](#-support)

---

## Why Blueprint Studio? 🌟
Tired of juggling external editors, SSH, or add-ons just to tweak your Home Assistant configs? Blueprint Studio brings the power of a full-fledged IDE right into your HA dashboard. Here's why it's a game-changer:

- **No External Tools Required** - Edit files directly in Home Assistant without SSH or file shares 🚫
- **Professional Editor** - Full-featured code editor with syntax highlighting and linting 💻
- **Safe & Secure** - Built-in protection against path traversal and unauthorized access 🛡️
- **Multi-File Editing** - Work with multiple files simultaneously using tabs 📁
- **File Management** - Create, delete, rename, copy, upload, and download files and folders 📂

---

## Screenshots 📸

<div align="center">

### Main Editor Interface
*Edit your Home Assistant configuration files with syntax highlighting and professional tools*

![Blueprint Studio Main Interface](images/screenshot.png)

---

### File Tree & Multi-Tab Support
*Navigate your config directory and work with multiple files simultaneously*

![File Tree Explorer](images/screenshot-file-tree.png)

---

### Real-Time YAML Validation
*Catch errors before saving with built-in YAML linting*

![YAML Validation](images/screenshot-yaml-validation.png)

---

### Multi-Tab Editing in Action
*Work efficiently with multiple files open at once*

![Multi-Tab Editing](images/screenshot-multi-tab.png)

---

### GitHub Integration 🔗 **NEW!**
*Complete Git workflow - stage, commit, and push directly from Blueprint Studio*

![Git Changes Panel](images/screenshot-git-changes.png)

---

### Git Settings & Authentication
*One-click OAuth login or Personal Access Token authentication*

![Git Settings Modal](images/screenshot-git-settings.png)

---

### Create GitHub Repositories
*Create new repositories without leaving Home Assistant*

![Create GitHub Repository](images/screenshot-create-repo.png)

---

### Complete Git Workflow
*Edit, stage, commit, and push - all in one place*

![Complete Git Workflow](images/screenshot-git-workflow.png)

</div>

<div align="center">
  <img src="https://dummyimage.com/600x100/0d1117/58a6ff&text=VS+Code-Like+Editing+in+HA" alt="Editor Preview">
</div>

---

## ✨ Features

### Editor Features 🎨
- **AI Studio Copilot (v2.0)** - Senior Home Assistant Configuration Expert with **Real Entity Awareness**, **7 Intelligent Scene Presets** (morning, evening, movie, reading, romantic, party, relax), **Advanced Script Generation** with multi-step sequences, delays & notifications, **Jinja Template Validation**, and **30+ Device Domains** with 100+ synonyms. Supports **Gemini 3** & **GPT-5** or runs entirely local by default 🧠
- **Syntax Highlighting** - Support for YAML, JSON, Python, JavaScript, HTML, CSS, Markdown, and Shell scripts 🌈
- **Code Folding** - Collapse and expand code sections for better focus 📜
- **Line Numbers** - Easy navigation with line numbers 🔢
- **Active Line Highlighting** - See your cursor position clearly 🎯
- **Bracket Matching** - Automatic bracket highlighting 🧩
- **Auto-close Brackets** - Automatic bracket completion ⌨️
- **Smart Autocomplete** - Intelligent suggestions for Home Assistant entities (type `light.` to see lights), keys, and values 🧠
- **YAML Snippets** - Templates for common HA patterns like Automations and Sensors (type `snip:`) 🧩
- **YAML Linting** - Real-time YAML syntax validation with error highlighting ❌
- **Jinja Template Support** - Full syntax highlighting for Jinja2 templates with distinct coloring for brackets, keywords, and variables 📝
- **Command Palette** - Instant access to all features with `Ctrl+K` ⌨️
- **UUID Generator** - Instantly insert a random UUID v4 with `Ctrl+Shift+U` 🆔
- **Professional Search** - Floating Find/Replace widget with navigation controls (`Ctrl+F`, `Ctrl+H`) 🔎
- **Global Search** - Search across all files with Regex and Case Sensitivity support (`Ctrl+Shift+F`). Now optimized to skip binary files and hidden folders for lightning-fast results 🌐
- **Entity Explorer Mode** - New mode in Global Search to browse the entity registry, view states, and copy IDs directly into your code 🔍
- **Filter by Content** - Sidebar toggle to filter the file tree by text content (e.g., find all files containing `input_boolean.test`) 📂

### Editor Customization ⚙️ **NEW in v2.0.0!**
- **Font Size** - Adjustable from 10px to 24px to suit your preference 🔤
- **Font Family** - Choose from 7 popular programming fonts (SF Mono, Fira Code, JetBrains Mono, Cascadia Code, Source Code Pro, Ubuntu Mono) 🔡
- **Word Wrap** - Toggle line wrapping for long lines ↩️
- **Line Numbers** - Show or hide line numbers #️⃣
- **Show Whitespace** - Display spaces and tabs visually ␣
- **Auto-Save** - Automatically save files after a configurable delay (500ms - 5000ms) 💾
- **Tabbed Settings** - New organized settings interface with General, Appearance, Editor, and Features tabs 🗂️

### UI Features 🎨
- **6 Theme Presets** - Choose from Dark, Light, High Contrast, Solarized Dark, Solarized Light, Ocean, and Dracula themes 🎨
- **Custom Accent Colors** - Personalize the accent color with 8 vibrant options 🔵🟣🔴🟢
- **Onboarding Wizard** - Step-by-step tour for new users to initialize and connect 🎓
- **File Tree Explorer** - Navigate your config directory with an expandable folder tree 🌳
- **File Type Icons** - Different colored icons for various file types (toggle on/off) 🎨
- **Compact File Tree Mode** - Dense layout option for smaller screens 📱
- **Multiple Tabs** - Open and edit multiple files simultaneously 🗂️
- **Resizable Sidebar** - Drag to resize the file explorer 📏
- **File Search** - Filter files in the explorer 🔍
- **Status Bar** - Shows cursor position, file type, and connection status 📊
- **Toast Notifications** - Elegant success/error messages with persistent error display 🔔
- **Custom Editor Colors** - Customize font colors for syntax highlighting (Comments, Keywords, Strings, etc.) in Settings 🎨

### File Management 📁
- **Create Files & Folders** - Right-click context menu for creating new items ➕
- **Bulk Operations** - New selection mode to pick multiple files and folders for batch actions 📦
- **Drag & Drop Reorganization** - Move files and folders by dragging them 📦
- **Upload Files** - Drag & drop files directly into the file tree or use the upload button ⬆️
- **Download Files** - Download individual files, multiple selected items, or entire folders as ZIP ⬇️
- **Copy & Paste** - Duplicate files and folders 📋
- **Rename & Move** - Rename files or move them to different locations 🔄
- **Delete** - Remove files and folders (with protection for critical files) 🗑️
- **Folder Operations** - Upload/download entire folder structures as ZIP files 📦
- **Folder Sizes** - View directory sizes directly in the file explorer 📊
- **Image Preview** - View images (PNG, JPG, SVG, etc.) directly in the editor 🖼️
- **Pin Favorites** - Pin frequently used files for quick access at the top of the sidebar 📌

### Git Integration 🔗 **NEW!**
- **Easy Authentication** - One-click OAuth Device Flow or manual PAT 🔐
- **Create GitHub Repos** - One-click repository creation directly from Blueprint Studio 🚀
- **Stay Logged In** - Credentials persist across restarts ✨
- **Push & Pull** - Sync your configs with GitHub 🔄
- **Commit History** - Dedicated panel to browse past commits and view full diffs 📜
- **Stage & Commit** - Manage changes with visual Git panel 📝
- **Explorer-Integrated Diff** - Click the "Difference" icon in the file tree for instant side-by-side reviews 🔍
- **Visual Diff Viewer** - Compare changes side-by-side before committing with color-coded highlighting 🌈
- **Smart Commit Messages** - Auto-generates messages based on staged files (e.g., "Update config") 🧠
- **Advanced Sync Recovery** - One-click tools to "Abort" stuck syncs or resolve "Diverged" history 🛡️
- **Branch Management** - Intelligent tools to repair local `master` -> `main` mismatches 🔄
- **Visual Sync Status** - Real-time arrows (↑/↓) showing commits ahead/behind remote 🔄
- **Advanced .gitignore** - Manage exclusions with a full interactive tree and automated redundancy filtering 🛡️
- **Safety Checks** - Proactively prompts to commit unstated changes before pushing 🛡️
- **Auto-Repair** - Detects and fixes "index.lock" and corrupt index errors with one click 🔧
- **Manage Remotes** - Add or remove remote repositories from Settings 🗑️
- **Automatic Status Updates** - Git panel updates automatically after file operations ⚡
- **Periodic Polling** - Detects changes made outside Blueprint Studio (every 30s) 🔄
- **Real-time Status** - See modified, added, deleted files instantly 👁️
- **GitHub Octicons** - Professional Git icons matching GitHub's UI 🎨

### Toolbar 🛠️
<div align="center">
  <img src="images/screenshot-toolbar-restart.png" alt="Restart Home Assistant Button" width="600">
  <p><em>New Restart Button - Quickly restart HA from the toolbar</em></p>
</div>

- Save / Save All 💾
- Undo / Redo ↶↷
- Cut / Copy / Paste ✂️📋
- Search / Replace 🔍🔄
- Bulk Select Mode ☑️
- YAML Validation ✅
- Restart Home Assistant 🔄
- Refresh file list 🔄
- Collapse/Expand all folders 📂📁
- Upload/Download files and folders ⬆️⬇️
- **Git Pull / Push / Status / Settings** 🔗

### Keyboard Shortcuts ⌨️
| Shortcut | Action |
|----------|--------|
| `Ctrl+E` / `Cmd+E` | Quick File Switcher 🔍 |
| `Ctrl+B` / `Cmd+B` | Toggle Sidebar 📂 |
| `Ctrl+Shift+]` | Next Tab ➡️ |
| `Ctrl+Shift+[` | Previous Tab ⬅️ |
| `Ctrl+F` / `Cmd+F` | Find in file 🔎 |
| `Ctrl+Shift+F` / `Cmd+Shift+F` | Global Search 🌐 |
| `Ctrl+Shift+U` / `Cmd+Shift+U` | Insert UUID 🆔 |
| `Ctrl+H` / `Cmd+H` | Replace in file 🔄 |
| `Ctrl+S` / `Cmd+S` | Save file 💾 |
| `Ctrl+Shift+S` / `Cmd+Shift+S` | Save all files 💾📁 |
| `Ctrl+G` / `Cmd+G` | Go to line 📍 |
| `Ctrl+/` / `Cmd+/` | Toggle comment 💬 |
| `Alt+W` | Close tab ❌ |
| `Ctrl+Z` / `Cmd+Z` | Undo ↶ |
| `Ctrl+Y` / `Cmd+Shift+Z` | Redo ↷ |
| `Enter` | Next Search Match (when search open) ⬇️ |
| `Shift+Enter` | Previous Search Match (when search open) ⬆️ |
| `Esc` | Close Modal / Search / Quick Switcher ✖️ |

---

## 🔧 Installation
This integration is best installed via the [Home Assistant Community Store (HACS)](https://hacs.xyz/).

### HACS (Recommended) 🛠️
1. **Add the Custom Repository**:
    * Ensure HACS is installed.
    * Go to **HACS > Integrations > ... (three dots) > Custom repositories**.
    * Add this repository's URL: `https://github.com/ha-china/blueprint-studio`
    * Select the category **Integration** and click **Add**.
 
      [![Open your Home Assistant instance and open a repository inside the Home Assistant Community Store (HACS).](https://my.home-assistant.io/badges/hacs_repository.svg)](https://my.home-assistant.io/redirect/hacs_repository/?owner=ha-china&repository=blueprint-studio&category=integration)
  
      [![Open your Home Assistant instance and start setting up a new integration.](https://my.home-assistant.io/badges/config_flow_start.svg)](https://my.home-assistant.io/redirect/config_flow_start/?domain=blueprint_studio)
      
2. **Install the Integration**:
    * In HACS, search for "Blueprint Studio" and click **Download**.
    * Follow the prompts to complete the download.
3. **Restart Home Assistant**:
    * Go to **Settings > System** and click the **Restart** button.
4. **Add the Integration**:
    * Go to **Settings > Devices & Services > Add Integration**.
    * Search for and select **Blueprint Studio**.
    * The setup wizard will guide you through the final configuration steps.

### Manual Installation 📥
1. Download the latest release from the [releases page](https://github.com/ha-china/blueprint-studio/releases) 📦
2. Extract the `blueprint_studio` folder to your `custom_components` directory 📂
3. Restart Home Assistant 🔄
4. Go to Settings → Devices & Services → Add Integration → Blueprint Studio ⚙️

<div align="center">
  <img src="https://dummyimage.com/500x60/0d1117/58a6ff&text=Quick+Install+via+HACS" alt="Installation Preview">
</div>

---

## ⚙️ Configuration
Blueprint Studio requires **no configuration**! After installation:
1. The integration will appear in Settings → Devices & Services 📋
2. A new "Blueprint Studio" menu item will appear in your Home Assistant sidebar 📂
3. Click it to start editing your files 🚀

**Note:** Blueprint Studio is admin-only for security reasons. Only users with administrator privileges can access it. 👑

---

## 🚀 Usage

### Getting Started 🎓
**New in v1.3.0!** First-time users are greeted with a guided tour to set up the editor. You can choose to enable Git integration for version control or keep it simple with just the file editor.

<div align="center">
  <img src="images/screenshot-onboarding.png" alt="Onboarding Wizard" width="600">
  <p><em>Onboarding Wizard - Guided setup with optional Git integration</em></p>
</div>

### Opening Files 📂
- Click on any file in the file tree to open it in the editor 🖱️
- Files open in new tabs, allowing you to work with multiple files simultaneously 🗂️
- Use the file search box to quickly find files 🔍

### Editing Files ✏️
- Make your changes in the editor 🎨
- Press `Ctrl+S` (or `Cmd+S` on Mac) to save 💾
- Use `Ctrl+Shift+S` to save all open files at once 📁

### Creating New Files ➕
- Right-click in the file tree where you want to create the file 🖱️
- Select "New File" or "New Folder" 📄
- Enter the name and the file will be created ✨

### Uploading Files ⬆️
- Use the upload button in the toolbar 📤
- Drag and drop files directly into the upload dialog 🖱️
- Choose whether to overwrite existing files ❓

### Downloading Files ⬇️
- Right-click on a file or folder 🖱️
- Select "Download" 📥
- Folders are downloaded as ZIP files 📦

### YAML Validation ✅
- Click the YAML validation button in the toolbar 🔍
- Any syntax errors will be highlighted in red ❌
- Hover over errors to see the error message 💡

### Pinning Favorites 📌
- **Pin files** - Click the pin icon next to any file in the tree to add it to favorites
- **Quick access** - Pinned files appear at the top of the sidebar for instant access
- **Persistent** - Your favorites are saved and persist across restarts
- **Unpin** - Click the pin icon again to remove from favorites
- **Visual indicator** - Pinned files show an orange pin icon

### AI Studio Copilot 🧠
**New in v2.5.0! Senior Home Assistant Configuration Expert with advanced intelligence.**

1. **Enable in Settings**: Go to **Settings** and toggle **"AI Studio Copilot"**.
2. **Choose Provider**: Select between **Local (Private)**, **Google Gemini**, or **OpenAI**.
3. **Smart Discovery**: The AI knows your real entity IDs! Just ask to "Turn on the living room lights."
4. **Intelligent Scene Generation**: Create scenes with natural language - "Create a morning scene for bedroom" generates 100% brightness at 4000K cool white. Supports 7 presets: morning, evening, movie, reading, romantic, party, relax.
5. **Advanced Script Generation**: Create multi-step scripts with delays, notifications, and mode detection (single, parallel, restart, queued). Say "Turn on lights, wait 5 minutes, then turn them off."
6. **Jinja Template Support**: Edit `.jinja`, `.jinja2`, and `.j2` files with syntax validation and error detection.
7. **YAML Error Detection**: Automatically detects 7+ common YAML errors (legacy syntax, indentation, missing colons) with line-by-line solutions.
8. **Multi-File Support**: Generate code specifically for `automations.yaml`, `scripts.yaml`, or `scenes.yaml`.
9. **Context Aware**: The Copilot analyzes your open file to provide targeted help and perfectly formatted YAML code blocks.

📖 **See Full Guides**: [AI_CAPABILITIES.md](./AI_CAPABILITIES.md) • [SCENE_SCRIPT_GUIDE.md](./SCENE_SCRIPT_GUIDE.md)

### GitHub Integration 🔗
**Sync your Home Assistant configuration with GitHub!**

<div align="center">
  <img src="images/screenshot-git-settings.png" alt="Git Settings Modal" width="800">
  <p><em>Git Settings - One-click OAuth login or Personal Access Token</em></p>
</div>

#### Quick Setup (30 seconds) ⚡
**OAuth is pre-configured - no setup needed!**

1. Click **Git Settings** button (GitHub icon in toolbar)
2. Click **"Login with GitHub OAuth"** (recommended)
3. Visit the URL shown and enter the code
4. Authorize Blueprint Studio
5. Done! You're logged in permanently ✅

<div align="center">
  <img src="images/screenshot-github-oauth.png" alt="GitHub OAuth Login" width="600">
  <p><em>GitHub OAuth Device Flow - Simple and secure authentication</em></p>
</div>

**Or use Personal Access Token (PAT):**
1. Create token at: https://github.com/settings/tokens
2. Enter username and token in Git Settings
3. Click "Save Credentials"

#### Creating a New Repository 🚀
**NEW! Create GitHub repositories without leaving Blueprint Studio:**

1. Click **Git Settings** button
2. Click **"Create New GitHub Repository"** button
3. Enter repository details:
   - Repository name (e.g., "home-assistant-config")
   - Description (optional)
   - Visibility (Private recommended for security)
4. Click **"Create Repository"**
5. Blueprint Studio automatically:
   - Creates the repo on GitHub
   - Initializes local git repository
   - Adds remote origin
   - Ready to push! ✅

<div align="center">
  <img src="images/screenshot-create-repo.png" alt="Create GitHub Repository" width="600">
  <p><em>Create GitHub Repository - One-click repo creation</em></p>
</div>

#### Advanced Management 🛠️
**Visual Sync Status & Exclusions**

<div align="center">
  <img src="images/screenshot-git-sync.png" alt="Visual Sync Status" width="800">
  <p><em>Visual Sync Status - See exactly how many commits to Push (↑) or Pull (↓)</em></p>
</div>

<div align="center">
  <img src="images/screenshot-gitignore-tree.png" alt="Advanced .gitignore Editor" width="600">
  <p><em>Advanced .gitignore - Manage exclusions with a full interactive file tree</em></p>
</div>

#### Using Git Features

<div align="center">
  <img src="images/screenshot-git-changes.png" alt="Git Changes Panel" width="800">
  <p><em>Git Changes Panel - Stage, commit, and push your changes</em></p>
</div>

- **Git Status** - Automatically updates when you save, create, delete, or modify files
- **Stage Files** - Click + icon next to files to stage
- **Commit** - Write commit message and commit
- **Push** - Upload changes to GitHub
- **Pull** - Download changes from GitHub
- **Auto-Refresh** - Git panel updates automatically every 30 seconds to catch external changes

<div align="center">
  <img src="images/screenshot-git-workflow.png" alt="Complete Git Workflow" width="800">
  <p><em>Complete Workflow - Edit, stage, commit, and push in one place</em></p>
</div>

**Your credentials persist across restarts!** No need to re-login.

**Note:** The Git Changes panel appears automatically when you have uncommitted changes and disappears when everything is committed. No manual refresh needed!

📖 **Full Guide:** See [GITHUB_AUTH_QUICKSTART.md](./GITHUB_AUTH_QUICKSTART.md) for complete instructions.

---

## 📄 Supported File Types
| Extension | Language | Icon |
|-----------|----------|------|
| `.yaml`, `.yml` | YAML | 🟡 |
| `.json` | JSON | 🔵 |
| `.py` | Python | 🐍 |
| `.js` | JavaScript | ⚡ |
| `.html` | HTML | 🌐 |
| `.css` | CSS | 🎨 |
| `.md` | Markdown | 📝 |
| `.sh` | Shell | 🐚 |
| `.txt`, `.log` | Plain Text | 📄 |
| `.conf`, `.cfg`, `.ini` | Config | ⚙️ |
| `.jinja`, `.jinja2`, `.j2` | Jinja2 Template | 📄 |
| `.pem`, `.crt`, `.key` | Certificate/Key | 🔒 |
| `.cpp`, `.h` | C++ (ESPHome) | 🇨 |
| `.db`, `.sqlite` | Database (Binary) | 🗄️ |
| `.bin`, `.ota`, `.der` | Binary/Firmware | 💾 |
| `.tar`, `.gz`, `.zip` | Archive | 📦 |

---

## 🔒 Security
Blueprint Studio includes multiple layers of security protection to keep your HA instance safe:

- **Path Traversal Protection** - Prevents access to files outside your Home Assistant config directory 🚫
- **Admin Only Access** - Only users with administrator privileges can use the editor 👑
- **Allowed File Extensions** - Only text-based configuration files can be edited (see Supported File Types) 📄
- **Excluded Directories** - Sensitive directories like `.storage`, `deps`, and `__pycache__` are hidden 🕶️
- **Protected Files** - Critical files like `configuration.yaml` and `secrets.yaml` cannot be deleted (but can be edited) 🛡️
- **Input Validation** - All file operations are validated to prevent malicious input 🔍
- **Authentication Required** - All API endpoints require Home Assistant authentication 🔐

**Best Practices:**
- Always backup your configuration before making major changes 💾
- Use YAML validation before saving configuration files ✅
- Test changes in a development environment when possible 🧪
- Keep regular backups of your Home Assistant configuration 🔄

---

## 🛠️ Troubleshooting
### Integration doesn't appear in sidebar ❓
- Ensure you've restarted Home Assistant after installation 🔄
- Check that you're logged in as an administrator 👑
- Clear your browser cache and refresh the page 🧹
- Check the Home Assistant logs for any errors 📋

### Files not showing in the tree 📂
- Some directories are excluded for security (`.storage`, `deps`, `.cache`, `.git`, etc.) 🛡️
- Hidden files (starting with `.`) are not shown unless "Show Hidden" is enabled 🕶️
- Only files with supported extensions are displayed 📄
- Empty folders are now visible (v1.2.0+) 📁
- Try clicking the refresh button in the toolbar 🔄

### Cannot save files 💾
- Ensure you have write permissions on the config directory 🔑
- Check that the file extension is in the allowed list 📄
- Verify there's enough disk space 💾
- Check the Home Assistant logs for permission errors 📋

### YAML validation shows errors ❌
- Review the error message by hovering over the red highlighted area 💡
- Common issues: incorrect indentation, missing colons, unquoted special characters 📝
- Use an online YAML validator for complex debugging 🌐
- Check the Home Assistant documentation for proper YAML syntax 📚

### Upload/Download not working ⬆️⬇️
- Check browser console for JavaScript errors 🛠️
- Ensure files are within size limits 📏
- Verify file extensions are allowed 📄
- Try a different browser if issues persist 🌐

### GitHub Login / Git Issues 🔗
- **Cannot login:** Check internet connection to github.com
- **Login expired:** Device code expires in 15 minutes, try again
- **Push/Pull fails:** Verify credentials are saved in Git Settings
- **Empty Git panel:** Click "Git Status" to refresh
- **Permission denied:** Check your GitHub PAT has `repo` scope
- **Credentials lost after restart:** This is fixed in v1.2.0+ with persistent storage

📖 **See:** [GITHUB_OAUTH_SETUP.md](./GITHUB_OAUTH_SETUP.md) for detailed troubleshooting.

---

## ❓ FAQ
**Q: Can I edit files outside the Home Assistant config directory?**  
A: No. Blueprint Studio is restricted to your Home Assistant config directory for security reasons. 🛡️

**Q: Why can't I see `.storage` or other hidden directories?**  
A: These directories are excluded for security. Editing files in `.storage` can corrupt your Home Assistant installation. ⚠️

**Q: Can non-admin users access Blueprint Studio?**  
A: No. Blueprint Studio requires administrator privileges to ensure only trusted users can edit configuration files. 👑

**Q: Does Blueprint Studio backup files automatically?**  
A: No. You should maintain your own backup strategy using Home Assistant's backup features or external tools. 💾

**Q: Can I use Blueprint Studio on mobile devices?**  
A: Yes, but the experience is optimized for desktop. A larger screen is recommended for editing. 📱

**Q: Will my changes take effect immediately?**  
A: Most configuration changes require reloading the affected integration or restarting Home Assistant. Blueprint Studio only saves files, it doesn't reload configurations. 🔄

**Q: Can I install multiple instances?**  
A: No. Blueprint Studio allows only one instance per Home Assistant installation. 🔒

**Q: Is syntax highlighting available for all file types?**  
A: Yes, for all supported file types listed in the Supported File Types section. 🌈

**Q: Can I customize the theme or editor settings?**
A: Yes! Blueprint Studio v2.2.0+ offers extensive customization:
- **6 Theme Presets**: Dark, Light, High Contrast, Solarized Dark, Solarized Light, Ocean, and Dracula
- **8 Accent Colors**: Choose your preferred highlight color
- **Font Options**: Adjust font size (10-24px) and family from 7 popular programming fonts
- **Editor Behavior**: Toggle word wrap, line numbers, whitespace visibility, and auto-save
- **File Tree**: Compact mode and icon visibility options
All settings are available in the Settings modal (gear icon) with a new tabbed interface. 🎨

**Q: Is the AI Copilot always on?**
A: No. For privacy and performance, the AI Copilot is disabled by default. You can enable it in the Settings modal when you need help. 🧠

**Q: Does Blueprint Studio support GitHub integration?**
A: Yes! Blueprint Studio v1.2.0+ includes full GitHub integration with OAuth Device Flow, persistent credentials, and visual Git operations (stage, commit, push, pull). 🔗

**Q: Do I need to re-login to GitHub after Home Assistant restart?**
A: No! Starting with v1.2.0, credentials persist across restarts. You stay logged in permanently. ✨

**Q: Can I see empty folders in the file tree?**
A: Yes! Starting with v1.2.0, empty folders are now visible in the file explorer. 📁

**Q: Which is better: OAuth Device Flow or PAT?**
A: OAuth Device Flow is recommended for easier setup. Both methods work equally well and persist credentials. See [GITHUB_AUTH_QUICKSTART.md](./GITHUB_AUTH_QUICKSTART.md) for comparison. 🔐



## 🤝 Contributing
Contributions are welcome! Here's how you can help: 🌍

### Reporting Issues 🐛
- Check existing issues before creating a new one 🔍
- Include Home Assistant version, browser, and OS information 📋
- Provide steps to reproduce the problem 📝
- Include relevant log entries if available 📄

### Pull Requests 🔄
1. Fork the repository 🍴
2. Create a feature branch (`git checkout -b feature/amazing-feature`) 🌿
3. Make your changes ✏️
4. Test thoroughly with Home Assistant 🧪
5. Commit your changes (`git commit -m 'Add amazing feature'`) 💾
6. Push to the branch (`git push origin feature/amazing-feature`) 🚀
7. Open a Pull Request 📤

### Development Setup 🛠️
1. Clone the repository into your Home Assistant's `custom_components` directory 📥
2. Restart Home Assistant 🔄
3. Make changes to the code ✏️
4. Restart Home Assistant to test changes 🔄
5. Check the Home Assistant logs for any errors 📋

### Code Style 📐
- Follow PEP 8 for Python code 🐍
- Use type hints where appropriate 💡
- Add comments for complex logic 📝
- Test all file operations thoroughly 🧪

---

## 📞 Support
If you encounter any issues or have feature requests:  
- Open an issue on [GitHub Issues](https://github.com/ha-china/blueprint-studio/issues) 🐛  
- Provide as much detail as possible 📝  
- Check existing issues first to avoid duplicates 🔍  

Join the conversation in the [Home Assistant Community Forum](https://community.home-assistant.io/t/custom-integration-for-file-editor-useful-for-home-assistant-docker/958933) or our [Discord](https://discord.gg/placeholder) (coming soon)! 💬

---

## 📄 License
This project is licensed under the MIT License - see the [LICENSE](LICENSE) file for details. 📜

---

## 🙌 Acknowledgments
Blueprint Studio is built with and inspired by:  
- **[CodeMirror](https://codemirror.net/)** - The powerful code editor that powers the editing experience 💻  
- **[Material Icons](https://fonts.google.com/icons)** - Beautiful icons for file types and UI elements 🎨  
- **[VS Code](https://code.visualstudio.com/)** - Design inspiration for the interface and user experience 🌟  
- **Home Assistant Community** - For feedback, testing, and feature suggestions 👏  

Special thanks to all contributors and users who help make Blueprint Studio better! 🎉

---

## ⚖️ Comparison with Other Solutions
| Feature | Blueprint Studio | File Editor (Official) | Studio Code Server | SSH/SFTP | Configurator |
|---------|------------------|------------------------|--------------------|----------|--------------|
| **Installation** | HACS/Custom Component | Add-on | Add-on | External Client | Deprecated |
| **Interface** | VS Code-like, Multi-tab | Simple, Single-file | Full VS Code | Terminal | Basic |
| **Resource Usage** | Lightweight | Low | High | Minimal | Low |
| **Security** | Built-in Restrictions | Basic | Full Access | Full Access | None |
| **File Management** | Full (Upload/Download/ZIP) | Basic | Full | Full | Limited |
| **Maintenance** | Active | Official | Community | N/A | Deprecated |

---
## Support the Project

This integration is developed and maintained in spare time and is provided free to the Home Assistant community.

If you find it useful and would like to support ongoing development, maintenance, and improvements, any contribution is appreciated — but never required ❤️

### Ways to Support

* **Ko-fi**
  [https://ko-fi.com/soulripper13](https://ko-fi.com/soulripper13)

* **PayPal**
  [https://paypal.me/SKatoaroo](https://paypal.me/SKatoaroo)

* **Bitcoin (BTC)**
  `bc1qvu8a9gdy3dcxa94jge7d3rd7claapsydjsjxn0`

* **Solana (SOL)**
  `4jvCR2YFQLqguoyz9qAMPzVbaEcDsG5nzRHFG8SeaeBK`

You can also help by:

* Reporting bugs
* Submitting pull requests
* Suggesting features
* Helping other users
* Starring the repository ⭐

Thank you for being part of the Home Assistant community.

---

## ⭐ Star History
If you find Blueprint Studio useful, please consider giving it a star on GitHub! 🌟

[![Star History Chart](https://api.star-history.com/svg?repos=ha-china/blueprint-studio&type=Date)](https://star-history.com/#ha-china/blueprint-studio&Date)

---

<div align="center">
  <strong>Made with ❤️ for the Home Assistant Community by <a href="https://github.com/soulripper13">soulripper13</a></strong>  
  <br>  
  Maintained by <a href="https://github.com/ha-china">HA China</a>
  <br>
  <a href="https://github.com/ha-china/blueprint-studio/blob/main/LICENSE">MIT License</a> • <a href="https://github.com/ha-china/blueprint-studio/issues">Report Bug</a> • <a href="https://github.com/ha-china/blueprint-studio">Update Changelog</a>
</div>

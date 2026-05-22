# Security Policy

## Supported Versions

We release patches for security vulnerabilities. Currently supported versions:

| Version | Supported          |
| ------- | ------------------ |
| 1.0.x   | :white_check_mark: |
| < 1.0   | :x:                |

## Reporting a Vulnerability

The Blueprint Studio team takes security bugs seriously. We appreciate your efforts to responsibly disclose your findings.

### How to Report a Security Vulnerability

**Please do not report security vulnerabilities through public GitHub issues.**

Instead, please report them via one of the following methods:

1. **GitHub Security Advisories** (Preferred):
   - Go to the [Security tab](https://github.com/ha-china/blueprint-studio/security/advisories)
   - Click "Report a vulnerability"
   - Fill out the form with details

2. **Email**:
   - Send an email to the repository owner through GitHub
   - Include as much information as possible (see below)

### What to Include in Your Report

Please include the following information:

- **Type of vulnerability**: (e.g., path traversal, XSS, authentication bypass, etc.)
- **Full paths of source file(s)** related to the vulnerability
- **Location of the affected source code** (tag/branch/commit or direct URL)
- **Step-by-step instructions** to reproduce the issue
- **Proof-of-concept or exploit code** (if possible)
- **Impact of the vulnerability**: What an attacker could do
- **Your assessment of severity** (Low, Medium, High, Critical)
- **Suggested fix** (if you have one)

### What to Expect

- **Acknowledgment**: We'll acknowledge receipt of your vulnerability report within 48 hours
- **Communication**: We'll keep you informed of our progress
- **Timeline**: We aim to release a fix within 90 days of disclosure
- **Credit**: We'll credit you in the security advisory (unless you prefer to remain anonymous)

## Security Best Practices for Users

When using Blueprint Studio:

1. **Keep Updated**: Always use the latest version
2. **Admin Only**: Only grant admin access to trusted users
3. **Regular Backups**: Maintain regular backups of your Home Assistant configuration
4. **Network Security**: Ensure your Home Assistant instance is properly secured
5. **HTTPS**: Always use HTTPS when accessing Home Assistant remotely
6. **Authentication**: Use strong passwords and enable two-factor authentication
7. **Review Changes**: Review file changes before saving, especially for critical files

## Known Security Considerations

Blueprint Studio implements several security measures:

### Path Traversal Protection
- All file paths are validated to prevent access outside the config directory
- Paths are resolved and checked against the base directory

### Authentication
- All API endpoints require Home Assistant authentication
- Only admin users can access Blueprint Studio

### File Type Restrictions
- Only whitelisted file extensions can be edited
- Binary files and executables are blocked

### Protected Paths
- Critical files (configuration.yaml, secrets.yaml) cannot be deleted
- Sensitive directories (.storage, deps) are hidden

### Input Validation
- All user input is validated
- File operations are checked for safety

## Scope

The following are **in scope** for security reports:
- Path traversal vulnerabilities
- Authentication bypass
- Unauthorized file access
- XSS vulnerabilities in the web interface
- CSRF vulnerabilities
- Code injection
- Privilege escalation

The following are **out of scope**:
- Issues in Home Assistant core
- Issues in third-party dependencies (report to upstream)
- Social engineering attacks
- Physical attacks
- Denial of Service attacks
- Issues requiring physical access to the server

## Security Update Policy

When a security vulnerability is identified:

1. A security advisory will be created
2. A patch will be developed and tested
3. A new version will be released
4. Users will be notified through:
   - GitHub Security Advisories
   - Release notes
   - HACS update notifications

## Disclosure Policy

- Security vulnerabilities will be disclosed publicly only after a fix is available
- We follow a coordinated disclosure timeline of 90 days
- We'll work with you to ensure proper credit is given
- We reserve the right to disclose earlier if the vulnerability is being actively exploited

## Comments on This Policy

If you have suggestions on how this process could be improved, please submit a pull request or open an issue.

## Recognition

We maintain a list of security researchers who have responsibly disclosed vulnerabilities:

<!-- This section will be updated as needed -->
*No vulnerabilities reported yet*

Thank you for helping keep Blueprint Studio and its users safe!

# ClaudeReview

**Automated AI code reviews for every git commit, powered by Claude Sonnet 4.5**

ClaudeReview automatically reviews your code changes using Anthropic's Claude AI whenever you make a git commit. Get instant, detailed feedback on security issues, bugs, code quality, and best practices - right in your editor.

![License](https://img.shields.io/badge/license-MIT-blue.svg)
![Node](https://img.shields.io/badge/node-%3E%3D18-brightgreen.svg)

## Features

- 🤖 **Automatic Reviews** - Triggers on every git commit across all repositories
- 🔍 **Deep Analysis** - Examines security, correctness, performance, and code quality
- 📝 **Detailed Reports** - CodeRabbit-style reviews with file:line references and exact patches
- 🎯 **Context-Aware** - Includes full file contents, related imports, README, and commit history
- 🚀 **Fast** - Reviews complete in 5-10 seconds
- 💰 **Cost Effective** - ~$0.03-0.10 per commit review
- 🔔 **Smart Notifications** - macOS notifications and auto-opens in Cursor/VSCode
- 🌍 **Global** - Works across ALL git repositories automatically

## Example Review Output

```markdown
# Review Summary
- **Scope:** 1 file, 26+ / 0-
- **Top risks:** SQL injection vulnerability, missing input validation
- **Confidence:** High

# Findings

## Critical / High

1) **[Critical | Security]** `user_service.js:9`
   - **Issue:** SQL injection vulnerability from string interpolation
   - **Why it matters:** Attackers can execute arbitrary SQL commands
   - **Fix (patch):**
     ```diff
     - const query = `SELECT * FROM users WHERE id = ${userId}`;
     + const query = 'SELECT * FROM users WHERE id = ?';
     + return await this.db.query(query, [userId]);
     ```
```

## Installation

### Prerequisites

- Node.js 18 or higher
- Git
- An [Anthropic API key](https://console.anthropic.com/settings/keys)

### Quick Start

1. **Clone the repository**
   ```bash
   git clone https://github.com/solaris-partners/ClaudeReview.git
   cd ClaudeReview
   ```

2. **Install dependencies**
   ```bash
   npm install
   ```

3. **Configure API key**
   ```bash
   cp .env.example .env
   # Edit .env and add your Anthropic API key
   ```

4. **Install global git hook**
   ```bash
   # Copy hook to global hooks directory
   mkdir -p ~/.git-hooks
   cp hooks/post-commit ~/.git-hooks/post-commit
   chmod +x ~/.git-hooks/post-commit

   # Configure git to use global hooks
   git config --global core.hooksPath ~/.git-hooks
   ```

5. **Update hook path** (if needed)

   Edit `~/.git-hooks/post-commit` and update line 16 with your ClaudeReview path:
   ```bash
   CLAUDE_REVIEW_DIR="$HOME/path/to/ClaudeReview"
   ```

6. **Test it!**
   ```bash
   # Make any commit in any repo
   cd ~/your-project
   git commit -m "test"
   # Review should appear automatically in 5-10 seconds
   ```

## Usage

Once installed, ClaudeReview works automatically:

1. **Make a commit** in any git repository
2. **Review runs** in the background (doesn't block your commit)
3. **Notification appears** when review is ready
4. **Review opens** automatically in Cursor/VSCode
5. **Review saved** to `~/.code-reviews/` for later reference

### Manual Review

You can also run reviews manually:

```bash
cd ClaudeReview
node src/index.js /path/to/repo <commit-hash>
```

### View Past Reviews

All reviews are saved as markdown files:

```bash
ls -lt ~/.code-reviews/
open ~/.code-reviews/your-repo_commit-hash_timestamp.md
```

## Configuration

### Changing the Editor

By default, reviews open in Cursor. To change this, edit `src/index.js` line ~258:

```javascript
// For VSCode
execSync(`code "${reviewFile}"`);

// For any other app
execSync(`open -a "YourEditor" "${reviewFile}"`);
```

### Disable for Specific Repositories

To disable reviews for a specific repo:

```bash
cd /path/to/repo
git config --local core.hooksPath ""
```

To re-enable:

```bash
cd /path/to/repo
git config --local --unset core.hooksPath
```

### Temporarily Disable Globally

```bash
# Disable
git config --global --unset core.hooksPath

# Re-enable
git config --global core.hooksPath ~/.git-hooks
```

## How It Works

### Architecture

```
┌─────────────────────┐
│   Git Commit        │
└──────────┬──────────┘
           │
           ▼
┌─────────────────────┐
│ Global Post-Commit  │◄── ~/.git-hooks/post-commit
│ Hook (Bash)         │
└──────────┬──────────┘
           │
           ▼
┌─────────────────────┐
│ ClaudeReview        │
│ (Node.js)           │
├─────────────────────┤
│ • Get commit diff   │
│ • Get full files    │
│ • Get README        │
│ • Get related files │
│ • Get commit history│
└──────────┬──────────┘
           │
           ▼
┌─────────────────────┐
│ Claude API          │◄── Anthropic Sonnet 4.5
│ (Code Review)       │
└──────────┬──────────┘
           │
           ▼
┌─────────────────────┐
│ Review Report       │
│ • Security issues   │
│ • Bugs & errors     │
│ • Code quality      │
│ • Exact patches     │
│ • Test suggestions  │
└──────────┬──────────┘
           │
           ▼
┌─────────────────────┐
│ Save to ~/.code-    │
│ reviews/            │
│ + Open in editor    │
│ + macOS notification│
└─────────────────────┘
```

### Context Provided to Claude

For accurate reviews, ClaudeReview provides:

1. **Commit diff** - Exact changes made
2. **Full file contents** - Complete files after the commit (first 10)
3. **Related files** - Imported/required files (up to 5)
4. **Repository README** - Project overview and conventions (first 5000 chars)
5. **Recent commits** - Last 5 commits for development context
6. **Commit metadata** - Author, date, message, stats

This rich context allows Claude to:
- Verify method existence before flagging issues
- Understand project conventions and patterns
- Catch integration issues with related code
- Provide more accurate, fewer false positives

## Review Quality

### What Gets Flagged

ClaudeReview prioritizes:
1. **Correctness** - Logic errors, null pointer issues, race conditions
2. **Security** - SQL injection, XSS, auth issues, credential exposure
3. **Performance** - N+1 queries, inefficient algorithms, memory leaks
4. **Reliability** - Error handling, input validation, edge cases
5. **Readability** - Code structure, naming, maintainability

### False Positive Prevention

The system is designed to minimize false positives:
- Verifies assumptions against full file contents
- "When in doubt, don't flag it" principle
- Only reports issues with high confidence
- Provides exact code patches for verification

## Cost Estimation

ClaudeReview uses Claude Sonnet 4.5:

- **Per commit:** ~$0.03-0.10 (varies by commit size)
- **Average:** ~$0.05 per commit
- **100 commits/month:** ~$5/month
- **500 commits/month:** ~$25/month

Tips to reduce costs:
- Reviews only analyze changed files (not entire codebase)
- Large commits cost more - consider smaller, focused commits
- Context limits prevent runaway token usage

## Troubleshooting

### Reviews not appearing?

1. Check git config:
   ```bash
   git config --global --get core.hooksPath
   # Should output: /Users/yourusername/.git-hooks
   ```

2. Check hook is executable:
   ```bash
   ls -la ~/.git-hooks/post-commit | grep 'x'
   ```

3. Check API key:
   ```bash
   cat ClaudeReview/.env
   ```

4. Test manually:
   ```bash
   cd ClaudeReview
   node src/index.js /path/to/repo $(git rev-parse HEAD)
   ```

### Reviews are inaccurate?

- Ensure you're using the latest version
- Check that context gathering is working (look for "Full File Contents" in review)
- Report false positives as GitHub issues

### Want to review old commits?

```bash
cd ClaudeReview
node src/index.js /path/to/repo <old-commit-hash>
```

## Development

### Project Structure

```
ClaudeReview/
├── src/
│   └── index.js          # Main review engine
├── hooks/
│   └── post-commit       # Git hook template
├── config/               # Future: per-project configs
├── .env                  # API key (not committed)
├── .env.example          # Template
├── .gitignore
├── package.json
├── LICENSE
└── README.md
```

### Running Tests

```bash
npm test  # Coming soon
```

### Contributing

Contributions welcome! Please:

1. Fork the repository
2. Create a feature branch
3. Make your changes
4. Add tests if applicable
5. Submit a pull request

## Roadmap

- [ ] Test file detection and pairing
- [ ] Project-specific config files (`.claudereview.json`)
- [ ] GitHub PR integration
- [ ] Slack notifications
- [ ] Support for more editors
- [ ] Caching of analysis for unchanged files
- [ ] Custom review templates per language/framework
- [ ] Team/organization shared configs
- [ ] CI/CD pipeline integration

## License

MIT License - see [LICENSE](LICENSE) file for details

## Credits

Built by the Solaris Partners team using:
- [Anthropic Claude API](https://www.anthropic.com/)
- [Node.js](https://nodejs.org/)
- Inspired by [CodeRabbit](https://coderabbit.ai/)

## Support

- **Issues:** [GitHub Issues](https://github.com/solaris-partners/ClaudeReview/issues)
- **Discussions:** [GitHub Discussions](https://github.com/solaris-partners/ClaudeReview/discussions)

---

Made with ❤️ by [Solaris Partners](https://github.com/solaris-partners)

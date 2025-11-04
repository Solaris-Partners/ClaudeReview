#!/usr/bin/env node

import Anthropic from '@anthropic-ai/sdk';
import { execSync } from 'child_process';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Configuration
const ANTHROPIC_API_KEY = process.env.ANTHROPIC_API_KEY;
const REVIEW_DIR = path.join(process.env.HOME, '.code-reviews');

// Ensure review directory exists
if (!fs.existsSync(REVIEW_DIR)) {
  fs.mkdirSync(REVIEW_DIR, { recursive: true });
}

/**
 * Get git diff for a specific commit
 */
function getCommitDiff(commitHash) {
  try {
    return execSync(`git show ${commitHash}`, { encoding: 'utf-8', maxBuffer: 10 * 1024 * 1024 });
  } catch (error) {
    console.error('Error getting commit diff:', error.message);
    return null;
  }
}

/**
 * Get commit metadata
 */
function getCommitMetadata(commitHash) {
  try {
    const message = execSync(`git log -1 --pretty=format:"%s" ${commitHash}`, { encoding: 'utf-8' });
    const author = execSync(`git log -1 --pretty=format:"%an" ${commitHash}`, { encoding: 'utf-8' });
    const date = execSync(`git log -1 --pretty=format:"%ad" ${commitHash}`, { encoding: 'utf-8' });
    const stats = execSync(`git show ${commitHash} --stat`, { encoding: 'utf-8' });

    return { message, author, date, stats };
  } catch (error) {
    console.error('Error getting commit metadata:', error.message);
    return null;
  }
}

/**
 * Extract imports/requires from a file to find related files
 */
function extractRelatedFiles(content, filePath) {
  const related = new Set();

  // Match various import patterns
  const patterns = [
    /require\(['"](.+?)['"]\)/g,  // require('...')
    /import.*from\s+['"](.+?)['"]/g,  // import ... from '...'
    /import\(['"](.+?)['"]\)/g,  // import('...')
  ];

  for (const pattern of patterns) {
    let match;
    while ((match = pattern.exec(content)) !== null) {
      let importPath = match[1];

      // Handle relative imports
      if (importPath.startsWith('.')) {
        const dir = path.dirname(filePath);
        const resolved = path.join(dir, importPath);

        // Try common extensions
        for (const ext of ['', '.js', '.ts', '.jsx', '.tsx', '.rb']) {
          related.add(resolved + ext);
        }
      }
    }
  }

  return Array.from(related);
}

/**
 * Get repository README content for project context
 */
function getReadmeContent() {
  const readmeFiles = ['README.md', 'README.txt', 'README'];

  for (const readme of readmeFiles) {
    try {
      const content = fs.readFileSync(readme, 'utf-8');
      return content.substring(0, 5000); // First 5000 chars
    } catch (error) {
      // File doesn't exist, try next
    }
  }

  return null;
}

/**
 * Get recent commit history for context
 */
function getRecentCommits(currentCommit, limit = 5) {
  try {
    const log = execSync(`git log --oneline -${limit} ${currentCommit}~1..HEAD~1 2>/dev/null || git log --oneline -${limit}`, {
      encoding: 'utf-8'
    }).trim();

    return log || null;
  } catch (error) {
    return null;
  }
}

/**
 * Get relevant context files (files that might be related to the changes)
 */
function getContextFiles(commitHash) {
  try {
    // Get list of files changed in this commit
    const changedFiles = execSync(`git diff-tree --no-commit-id --name-only -r ${commitHash}`, {
      encoding: 'utf-8'
    }).trim().split('\n');

    const contextFiles = {};
    const relatedFiles = new Set();

    // Get changed files and detect related files
    for (const file of changedFiles) {
      if (!file) continue;

      try {
        // Get the file content after the commit
        const content = execSync(`git show ${commitHash}:${file}`, {
          encoding: 'utf-8',
          maxBuffer: 1024 * 1024 // 1MB limit per file
        });
        contextFiles[file] = content;

        // Extract related files from imports
        const related = extractRelatedFiles(content, file);
        related.forEach(f => relatedFiles.add(f));
      } catch (error) {
        // File might be deleted or binary
        contextFiles[file] = '[File not available or binary]';
      }
    }

    // Try to include related files (but limit total)
    const maxRelatedFiles = 5;
    let relatedCount = 0;

    for (const relatedFile of relatedFiles) {
      if (relatedCount >= maxRelatedFiles) break;
      if (contextFiles[relatedFile]) continue; // Already included

      try {
        const content = fs.readFileSync(relatedFile, 'utf-8');
        if (content.length < 100000) { // Skip very large files
          contextFiles[relatedFile] = content;
          relatedCount++;
        }
      } catch (error) {
        // File doesn't exist or can't be read
      }
    }

    return contextFiles;
  } catch (error) {
    console.error('Error getting context files:', error.message);
    return {};
  }
}

/**
 * Perform code review using Claude API
 */
async function performReview(repoPath, commitHash) {
  const repoName = path.basename(repoPath);

  console.log(`\n🔍 Starting review for ${repoName} (commit ${commitHash.substring(0, 8)})...`);

  // Get commit information
  const metadata = getCommitMetadata(commitHash);
  if (!metadata) {
    console.error('Failed to get commit metadata');
    return;
  }

  const diff = getCommitDiff(commitHash);
  if (!diff) {
    console.error('Failed to get commit diff');
    return;
  }

  // Get full file contents after the commit
  const contextFiles = getContextFiles(commitHash);

  // Get repository README for project context
  const readmeContent = getReadmeContent();

  // Get recent commit history
  const recentCommits = getRecentCommits(commitHash);

  // Initialize Anthropic client
  const anthropic = new Anthropic({
    apiKey: ANTHROPIC_API_KEY,
  });

  // Build the review prompt
  // Build README context section
  let readmeSection = '';
  if (readmeContent) {
    readmeSection = `\n# Repository Context (README)\n\`\`\`\n${readmeContent}\n\`\`\`\n`;
  }

  // Build recent commits section
  let recentCommitsSection = '';
  if (recentCommits) {
    recentCommitsSection = `\n# Recent Commits (for context)\n\`\`\`\n${recentCommits}\n\`\`\`\n`;
  }

  // Build file context section
  let fileContextSection = '';
  const fileEntries = Object.entries(contextFiles).slice(0, 10); // Limit to first 10 files to avoid token overflow

  if (fileEntries.length > 0) {
    fileContextSection = '\n# Full File Contents (After Commit)\n';
    for (const [filename, content] of fileEntries) {
      if (content !== '[File not available or binary]' && content.length < 50000) {
        fileContextSection += `\n## ${filename}\n\`\`\`\n${content.substring(0, 50000)}\n\`\`\`\n`;
      }
    }
  }

  const prompt = `SYSTEM ROLE
You are a senior AI code reviewer (CodeRabbit-style). Your job: quickly understand the change set, surface the highest-impact issues, and leave crisp, actionable, inline comments. Always be specific, cite file:line, propose exact fixes, and suggest targeted tests. Prefer fewer, higher-quality comments to noisy lint.

⚠️ CRITICAL: AVOID FALSE POSITIVES
- ONLY flag issues that are DEFINITELY introduced by THIS commit
- VERIFY your assumptions against the full file contents provided below
- If you see a method being called, CHECK if it exists in the full file content before flagging it as missing
- DO NOT flag speculative issues or assume missing code without evidence
- When in doubt, DO NOT flag it - false positives are worse than false negatives

INPUTS
- **Repository:** ${repoName}
- **Commit Hash:** ${commitHash}
- **Author:** ${metadata.author}
- **Date:** ${metadata.date}
- **Commit Message:** ${metadata.message}

# Commit Statistics
\`\`\`
${metadata.stats}
\`\`\`

# Diff / Changes
\`\`\`diff
${diff}
\`\`\`
${readmeSection}${recentCommitsSection}${fileContextSection}

REVIEW RULES
- Prioritize correctness → security → performance → reliability → DX/readability → style.
- Only comment where the change set touches; if a broader refactor is needed, flag once under "Opportunities."
- For every issue, include: severity, file:line, 1-sentence diagnosis, why it matters, and a concrete patch or code snippet.
- Group similar nits; do not spam line-by-line cosmetic notes.
- Prefer minimal diffs; preserve author intent.
- If you're uncertain, ask 1 clarifying question max—then propose a safe default.
- BEFORE flagging an issue, verify it against the full file contents provided above.

OUTPUT FORMAT (Markdown)

# Review Summary
- **Scope:** {{files_changed}} files, {{lines_added}}+ / {{lines_removed}}-
- **Top risks (TL;DR):** 1–3 bullets, plain English.
- **Confidence:** High | Medium | Low (and why)

# Findings
Organize by **Severity** and **Category**. Severity ∈ {Critical, High, Medium, Low}. Categories ∈ {Correctness, Security, Performance, Reliability, Readability, Testing, Docs}.

## Critical / High
1) **[Severity | Category]** \`path/to/file.ext:LINE\`
   - **Issue:** one-sentence description.
   - **Why it matters:** impact or failure mode.
   - **Fix (patch):**
     \`\`\`diff
     --- a/path/to/file.ext
     +++ b/path/to/file.ext
     @@
     - {{old}}
     + {{new}}
     \`\`\`
   - **Follow-ups (if any):** brief.

## Medium / Low
- Use the same structure but keep it concise; batch cosmetic suggestions.

# Inline Comments (for PR tools)
Post the following as line comments:

- \`path/to/file.ext:LINE\` — **[Severity | Category]** short title
  _Issue:_ …
  _Fix:_ one-liner or tiny code block.

(repeat for each)

# Tests to Add / Update
- **Unit:** list exact test names or files to create/update, including edge cases and fixtures.
- **Integration/Contract:** what to mock, what to hit for real.
- **Negative paths:** failure modes to assert.
- **Coverage hotspots:** which functions/branches lack coverage.

# Security & Perf Scan
- **Security:** input validation, authZ/authN, secrets, SSRF/SQLi/XSS, deserialization, dependency risk (name exact package@version).
- **Performance:** complexity notes, N+1 queries, sync vs async, allocations, hot loops; include a micro-optimization only if measurable.

# API/Behavior Changes
- Public surface changes, migrations, deprecations, backward-compat notes.
- **Release notes snippet:**
{{ONE-PARAGRAPH HUMAN CHANGELOG}}

# Opportunities (Optional, Non-blocking)
- Small refactors, abstractions, or docs that would pay off next.

# Ready-to-Use Labels / Actions
- **Labels:** \`needs-tests\`, \`security\`, \`perf\`, \`breaking-change\`, \`refactor\`, \`docs\`
- **Actions:** Approve if {{CONDITIONS}}; otherwise "Request changes" with blocking items: (list).

# One Question (if needed)
- A single, high-leverage question that could change the decision.

POST-PROCESSING GUIDELINES
- Limit Critical/High to items that materially break correctness, safety, or user experience.
- Provide exact code patches whenever possible.
- If the diff is mostly churn/generated, say so and skip to "Ready-to-Use Labels / Actions."`;

  try {
    console.log('⏳ Analyzing commit with Claude Sonnet 4.5...');

    const message = await anthropic.messages.create({
      model: 'claude-sonnet-4-20250514',
      max_tokens: 8192,
      messages: [
        {
          role: 'user',
          content: prompt
        }
      ]
    });

    const review = message.content[0].text;

    // Save review to file
    const timestamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, -5);
    const reviewFile = path.join(REVIEW_DIR, `${repoName}_${commitHash.substring(0, 8)}_${timestamp}.md`);

    const reviewContent = `# Code Review Report

**Repository:** ${repoName}
**Commit:** ${commitHash}
**Author:** ${metadata.author}
**Date:** ${metadata.date}
**Message:** ${metadata.message}
**Reviewed:** ${new Date().toLocaleString()}

---

${review}

---

*Review generated by Claude (Sonnet 4.5)*
`;

    fs.writeFileSync(reviewFile, reviewContent);

    console.log('✅ Review completed successfully!');
    console.log(`📝 Review saved to: ${reviewFile}`);

    // Show notification on macOS
    try {
      execSync(`osascript -e 'display notification "Review completed for ${repoName}" with title "Code Review Ready" sound name "Glass"'`);
    } catch (error) {
      // Notification failed, but that's okay
    }

    // Open the review file in Cursor
    try {
      execSync(`open -a "Cursor" "${reviewFile}"`);
      console.log('📂 Opening review in Cursor...');
      console.log('💡 Tip: Press Cmd+Shift+V to open Markdown preview');
    } catch (error) {
      console.log('⚠️  Could not auto-open file. You can view it manually at:', reviewFile);
    }

    // Print summary to console
    console.log('\n' + '='.repeat(80));
    console.log(review);
    console.log('='.repeat(80) + '\n');

  } catch (error) {
    console.error('Error performing review:', error.message);

    // Save error to file
    const timestamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, -5);
    const errorFile = path.join(REVIEW_DIR, `${repoName}_${commitHash.substring(0, 8)}_${timestamp}_ERROR.txt`);
    fs.writeFileSync(errorFile, `Error during review:\n\n${error.message}\n\n${error.stack}`);
  }
}

// Main execution
async function main() {
  const args = process.argv.slice(2);

  if (args.length !== 2) {
    console.error('Usage: node index.js <repo-path> <commit-hash>');
    process.exit(1);
  }

  const [repoPath, commitHash] = args;

  // Verify API key
  if (!ANTHROPIC_API_KEY) {
    console.error('Error: ANTHROPIC_API_KEY environment variable not set');
    process.exit(1);
  }

  // Change to repo directory
  process.chdir(repoPath);

  await performReview(repoPath, commitHash);
}

main().catch(console.error);

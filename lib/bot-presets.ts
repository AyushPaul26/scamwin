/** Editable starting points for developer agents, not connected integrations. */
export const BOT_PRESETS = [
  {
    id: "nodejs",
    label: "Node.js developer",
    job: "Node.js developer",
    instructions: "Build Node.js APIs using the repo’s conventions. Add focused tests and handle errors. Summarize changes and checks for the GitLab merge request.",
  },
  {
    id: "react",
    label: "React developer",
    job: "React developer",
    instructions: "Build accessible React interfaces using existing components. Check mobile layouts and user flows. Explain changes and tests in the merge request.",
  },
  {
    id: "python",
    label: "Python developer",
    job: "Python developer",
    instructions: "Build Python services and automation using the repo’s conventions. Add tests and validate inputs. Summarize changes and checks in the merge request.",
  },
  {
    id: "review",
    label: "Code reviewer",
    job: "Review GitLab merge requests",
    instructions: "Review the diff for bugs, regressions, and missing tests. Cite affected files and lines. Suggest focused fixes and distinguish blockers from suggestions.",
  },
  {
    id: "security",
    label: "Security engineer",
    job: "Triage and remediate security findings",
    instructions: "Triage GitLab security and dependency findings. Verify impact before proposing a fix. Add regression tests and never include secrets in reports.",
  },
  {
    id: "cicd",
    label: "CI/CD engineer",
    job: "Fix GitLab pipelines and prepare releases",
    instructions: "Diagnose failed GitLab jobs and improve tests, builds, and releases. Verify changes in the pipeline. Request approval before production deployment.",
  },
] as const;

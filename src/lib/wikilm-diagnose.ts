/** Map a Contents PUT 404 + repo metadata into a human-readable message. */
export function diagnoseContentsWrite404(input: {
  owner: string;
  repo: string;
  branch: string;
  fullPath: string;
  putBodyText: string;
  repoStatus: number;
  repoSize?: number;
  defaultBranch?: string;
}): string {
  const { owner, repo, branch, fullPath, putBodyText, repoStatus, repoSize, defaultBranch } = input;
  if (repoStatus === 404) {
    return `GitHub 404 writing ${fullPath}: token can't access ${owner}/${repo}. Re-create the fine-grained PAT with that repo selected and Contents: Read and write.`;
  }
  if (repoStatus === 200 && (repoSize ?? 0) === 0) {
    return `GitHub 404 writing ${fullPath}: ${owner}/${repo} is empty. On GitHub, add a README (or any commit) to create the default branch, then try again.`;
  }
  if (defaultBranch && branch && defaultBranch !== branch) {
    return `GitHub 404 writing ${fullPath}: branch “${branch}” not found (repo default is “${defaultBranch}”). Set WIKILM_GITHUB_BRANCH=${defaultBranch} or unset it.`;
  }
  return `GitHub 404 writing ${fullPath}: ${putBodyText.slice(0, 160) || "Not Found"}. Check token repo access, branch, and that the wiki path is correct.`;
}

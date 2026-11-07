export type GithubProfileRank = 'user' | 'admin' | 'master-admin'

export function canLinkGithubProfileByLogin(
  profile: { github_user_id: string | null; rank: GithubProfileRank },
  githubUserId: string,
): boolean {
  return profile.github_user_id === githubUserId
    || (profile.github_user_id === null && profile.rank === 'user')
}

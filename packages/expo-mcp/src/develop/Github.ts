import { mkdir, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';

const GH_API_BASE = 'https://api.github.com';
const GH_RAW_BASE = 'https://raw.githubusercontent.com';

interface GitTreeEntry {
  path: string;
  mode: string;
  type: 'blob' | 'tree' | 'commit';
  sha: string;
  size?: number;
}

interface GitTreeResponse {
  sha: string;
  url: string;
  tree: GitTreeEntry[];
  truncated: boolean;
}

interface CommitResponse {
  sha: string;
  commit: {
    tree: {
      sha: string;
    };
  };
}

async function ghJson<T = unknown>(url: string, token?: string): Promise<T> {
  const res = await fetch(url, {
    headers: {
      Accept: 'application/vnd.github+json',
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
  });
  if (!res.ok) throw new Error(`${res.status} ${res.statusText} for ${url}`);
  return res.json() as Promise<T>;
}

/**
 * Downloads a folder from a GitHub repository using the Git Trees API.
 * This approach uses only 2 API calls regardless of folder depth:
 * 1. Get the commit to find the tree SHA
 * 2. Get the full tree recursively
 * Then downloads files in parallel from raw.githubusercontent.com (CDN, no rate limit).
 */
export async function fetchFolderFromGithubRepo(options: {
  owner: string;
  repo: string;
  path: string; // folder path in repo
  ref?: string; // branch/tag/sha (optional, defaults to HEAD)
  outDir: string; // local destination
  token?: string; // optional, avoids rate limits
}) {
  const { owner, repo, path, ref = 'HEAD', outDir, token } = options;

  // Normalize the target path (remove leading/trailing slashes)
  const normalizedPath = path.replace(/^\/+/g, '').replace(/\/+$/g, '');
  const pathPrefix = normalizedPath ? `${normalizedPath}/` : '';

  // Step 1: Get the tree SHA from the commit
  const commitUrl = `${GH_API_BASE}/repos/${owner}/${repo}/commits/${encodeURIComponent(ref)}`;
  console.log('Fetching commit:', commitUrl);
  const commit = await ghJson<CommitResponse>(commitUrl, token);
  const treeSha = commit.commit.tree.sha;

  // Step 2: Get the full tree recursively (single API call)
  const treeUrl = `${GH_API_BASE}/repos/${owner}/${repo}/git/trees/${treeSha}?recursive=1`;
  console.log('Fetching tree:', treeUrl);
  const tree = await ghJson<GitTreeResponse>(treeUrl, token);

  if (tree.truncated) {
    console.warn(
      'Warning: Tree response was truncated (>100k entries). Some files may be missing.'
    );
  }

  // Step 3: Filter to only blobs (files) within the target path
  const files = tree.tree.filter(
    (entry) =>
      entry.type === 'blob' &&
      (normalizedPath === '' || entry.path === normalizedPath || entry.path.startsWith(pathPrefix))
  );

  if (files.length === 0) {
    throw new Error(`No files found at path "${normalizedPath}" in ${owner}/${repo}`);
  }

  console.log(`Downloading ${files.length} files from ${owner}/${repo}/${normalizedPath}...`);

  // Step 4: Download all files in parallel from raw.githubusercontent.com
  await mkdir(outDir, { recursive: true });

  await Promise.all(
    files.map(async (file) => {
      // Build the raw URL: https://raw.githubusercontent.com/{owner}/{repo}/{ref}/{path}
      const rawUrl = `${GH_RAW_BASE}/${owner}/${repo}/${ref}/${file.path}`;

      const res = await fetch(rawUrl, {
        headers: token ? { Authorization: `Bearer ${token}` } : undefined,
      });

      if (!res.ok) {
        throw new Error(`Failed to download ${rawUrl}: ${res.status} ${res.statusText}`);
      }

      // Calculate relative path within the target folder
      const relativePath = file.path.startsWith(pathPrefix)
        ? file.path.slice(pathPrefix.length)
        : file.path;

      const dest = join(outDir, relativePath);
      await mkdir(dirname(dest), { recursive: true });

      const buf = Buffer.from(await res.arrayBuffer());
      await writeFile(dest, buf);
    })
  );

  console.log(`Successfully downloaded ${files.length} files to ${outDir}`);
}

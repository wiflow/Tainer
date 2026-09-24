function sanitizeFileNameSegment(value: string): string {
  return value.replace(/[/\\.\0]/g, "_");
}

export function buildDockerOciReference(
  namespace: string,
  repository: string,
  tag: string,
) {
  return `docker.io/${namespace}/${repository}:${tag}`;
}

export function buildOciTemplateFileNameAliases(
  namespace: string,
  repository: string,
  tag: string,
) {
  const safeRepo = sanitizeFileNameSegment(repository);
  const safeTag = sanitizeFileNameSegment(tag);
  const safeNs = sanitizeFileNameSegment(namespace);

  const primaryFileName = `${safeRepo}_${safeTag}.tar`;
  const legacyFileName =
    namespace === "library" ? primaryFileName : `${safeNs}_${safeRepo}_${safeTag}.tar`;

  return [...new Set([primaryFileName, legacyFileName])];
}

export function buildOciTemplateFileName(
  namespace: string,
  repository: string,
  tag: string,
) {
  return buildOciTemplateFileNameAliases(namespace, repository, tag)[0] ?? `${sanitizeFileNameSegment(repository)}_${sanitizeFileNameSegment(tag)}.tar`;
}

export function matchesOciTemplateFileName(
  namespace: string,
  repository: string,
  fileName: string,
) {
  const normalizedFileName = fileName.trim();
  const candidatePrefixes = [...new Set([
    `${repository}_`,
    namespace === "library" ? "" : `${namespace}_${repository}_`,
  ])].filter(Boolean);

  return candidatePrefixes.some(
    (prefix) =>
      normalizedFileName.startsWith(prefix) && normalizedFileName.endsWith(".tar"),
  );
}

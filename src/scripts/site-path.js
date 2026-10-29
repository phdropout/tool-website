// Public files and manually written links must include the deployment base.
export function sitePath(path = "") {
  const base = import.meta.env.BASE_URL.replace(/\/?$/, "/");
  return `${base}${path.replace(/^\/+/, "")}`;
}

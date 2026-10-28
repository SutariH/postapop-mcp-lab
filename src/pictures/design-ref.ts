/**
 * Turns what the model sent into a Sketchpad design id, or nothing.
 *
 * The model may send an id ("SPk2wQ9pLmA") or a link it got from Sketchpad's
 * own connector ("https://sketchpad.example/design/SPk2wQ9pLmA/edit"). The
 * server never follows the link: it only reads the id out of it, and then
 * asks Sketchpad through its own connection. So there is nothing to fetch
 * from an address the model chose, and no server-side request forgery.
 */
const DESIGN_ID = /^SP[A-Za-z0-9_-]{9}$/;
const SKETCHPAD_HOST = 'sketchpad.example';

export function parseDesignRef(input: string) {
  const value = input.trim();
  if (DESIGN_ID.test(value)) {
    return value;
  }

  let url: URL;
  try {
    url = new URL(value);
  } catch {
    return undefined;
  }
  // https only, Sketchpad's own host, no port and no user name: a link
  // that looks almost right is still refused.
  if (url.protocol !== 'https:' || url.hostname !== SKETCHPAD_HOST || url.port || url.username || url.password) {
    return undefined;
  }
  const match = /^\/design\/([^/]+)(\/.*)?$/.exec(url.pathname);
  return match?.[1] && DESIGN_ID.test(match[1]) ? match[1] : undefined;
}

/** Board order for categories, shared by host, player, and projector so all three
 *  screens (and the round-start reveal sequence) agree on left-to-right order.
 *
 *  `position` is the index the category had in the imported JSON. It is optional:
 *  content imported before the position column existed (or against a database
 *  missing it) has null/undefined and falls back to alphabetical by name, which
 *  is what every screen did before board order was introduced. */
export function compareCategoryOrder(
  a: { position?: number | null; name: string },
  b: { position?: number | null; name: string },
): number {
  const ap = a.position ?? Number.MAX_SAFE_INTEGER
  const bp = b.position ?? Number.MAX_SAFE_INTEGER
  return ap !== bp ? ap - bp : a.name.localeCompare(b.name)
}

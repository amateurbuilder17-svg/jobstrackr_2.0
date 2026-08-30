import { MenuDrawer } from "./menu-drawer";
import { MenuList } from "./menu-list";

/**
 * The drawer, with its contents.
 *
 * A Server Component whose only job is to put the server-rendered list inside
 * the client-rendered panel. Keeping these two apart is what makes the split
 * work: `MenuDrawer` ships as JavaScript and knows nothing about what is in the
 * menu; `MenuList` is HTML and knows nothing about how it is shown.
 */
export function MenuPanel() {
  return (
    <MenuDrawer>
      <MenuList dense />
    </MenuDrawer>
  );
}

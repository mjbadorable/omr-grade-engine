/** Test helper: orgs.create is internal-only (not callable by browsers), so tests create schools through it on behalf of a signed-in user. */
import type { TestConvex } from "convex-test";
import { api, internal } from "../../convex/_generated/api";
import type schema from "../../convex/schema";

type Backend = TestConvex<typeof schema>;
type Caller = { query: Backend["query"] };

export async function createOrg(t: Backend, who: Caller, name: string) {
  const me = await who.query(api.users.me, {});
  if (!me) throw new Error("createOrg: the user must call users.store first");
  return t.mutation(internal.orgs.create, { name, createdBy: me._id });
}

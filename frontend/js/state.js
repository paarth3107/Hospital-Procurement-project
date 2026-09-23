// Shared mutable app state. Modules import the object and mutate its
// properties (never reassign `state` itself) so every importer keeps
// seeing the same live values -- this is what makes state sharing across
// ES modules work without a framework.
export const state = {
  token: sessionStorage.getItem("token") || null,
  actorType: sessionStorage.getItem("actorType") || null, // "staff" | "vendor"
  user: null,
  vendor: null,
};

/**
 * The experiment tool names, in registration order, in a module with no
 * server imports so the page can list them. lib/workbench/experimentTools.ts
 * asserts it registers exactly these.
 */
export const EXPERIMENT_TOOL_NAMES = [
  'create_experiment',
  'run_step',
  'conclude_experiment',
  'list_experiments',
  'get_experiment',
] as const

/**
 * Think-tag plugin, node half. Pure UI plugin: the empty apply exists so the
 * plugin appears in the host cordis.yml / Loader; the browser half ships via
 * exports["./client"], discovered through the package.json dsh.client
 * declaration. The inline tag rides the composer draft (model-visible
 * content is logged draft content), so no host-side behavior exists.
 */

/** Host plugin body — no host-side behavior for the think-tag surface plugin. */
export function apply(): void {}

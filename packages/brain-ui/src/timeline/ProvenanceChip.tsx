import { displayModelName, servedModelLabel, type MessageProvenance, type ModelIdentityContext } from '@seanhogg/builderforce-brain-embedded';
import type { BrainTimelineLabels } from './labels';

/**
 * The per-reply provenance chip: what served this turn, and whose account paid for it.
 * A positive confirmation on EVERY assistant turn that the tenant is (or is not) on
 * their own connected frontier account — so "why didn't it use my paid Claude?" is
 * answered inline instead of only surfacing on an empty reply. The `shared_byo_unused`
 * state is styled as a warning because it's the one the user most wants to catch (a
 * connected account that silently wasn't used).
 *
 * WHAT it names depends on who is reading: a turn our routed pool served is named after
 * the PRODUCT ("Builderforce Free" / "Builderforce PRO") unless the viewer owns the
 * choice — see `modelIdentity.ts`. The upstream id stays on the message metadata either
 * way, so diagnostics and usage attribution are unaffected.
 *
 * The account is optional: when the gateway didn't report one the chip still names what
 * ran and simply omits the badge — attribution without a claim we can't back.
 */
export function ProvenanceChip({
  prov,
  labels,
  identity,
}: {
  prov: MessageProvenance;
  labels: BrainTimelineLabels;
  identity: ModelIdentityContext;
}) {
  const unused = prov.account === 'shared_byo_unused';
  // WHERE it ran, from the ref and the runtime registry (`servedModelLabel`) - never from the `local/` prefix: an engine
  // on this device says so; a hosted runtime reached from this machine (Kimi Code) is the person's own account.
  const served = servedModelLabel(prov.model);
  const account = served.hostedFromHere ? 'own' : prov.account;
  const badge = served.onDevice
    ? labels.accountOnDevice
    : account === 'own'
      ? labels.accountOwn
      : unused
        ? labels.accountByoUnused
        : account === 'shared'
          ? labels.accountShared
          : null;
  const variant = served.onDevice || account === 'own'
    ? 'bf-tl__prov--own'
    : unused
      ? 'bf-tl__prov--unused'
      : 'bf-tl__prov--shared';
  // Masked viewers get the product name in the tooltip too — a vendor suffix would
  // give away exactly what the name is there to abstract. A served `local/` model is the viewer's own choice: named
  // by its catalogue name (else the model's last segment) with the raw id kept in the tooltip.
  const name = served.name ?? displayModelName(prov.model, identity, { account });
  const modelTitle = served.name
    ? prov.model
    : prov.vendor && name === prov.model ? `${name} · ${prov.vendor}` : name;
  return (
    <div className={`bf-tl__prov ${variant}`}>
      <span className="bf-tl__prov-model" title={modelTitle}>{name}</span>
      {badge && <span className="bf-tl__prov-badge">{badge}</span>}
      {prov.evermind ? (
        <span className="bf-tl__prov-evermind" title={labels.ranOnEvermind}>{`🧠 Evermind v${prov.evermind.version}`}</span>
      ) : null}
    </div>
  );
}

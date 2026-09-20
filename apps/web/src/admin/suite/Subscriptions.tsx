/**
 * Subscriptions — **an editing screen, not a report** (handoff §3).
 *
 * It is where tiers, prices and published benefits are set, which makes it the
 * one screen in the suite whose figures somebody types rather than reads. Three
 * things follow from that, and all three are in the code rather than in a note.
 *
 *  · **Changing a price writes a new price row.** Existing subscriptions keep
 *    the row they were sold on, so last quarter's revenue cannot be rewritten
 *    by today's decision (`plan_prices`, insert-only, migration 200). The panel
 *    says so on its face, and it is true.
 *  · **Annual is derived as you type.** `round(monthly × 12 × (1 −
 *    discount/100))`, per channel, computed on the client from the same
 *    function the server uses — so the tile, the derived row and the revenue
 *    line move together and cannot disagree.
 *  · **An edit is local until it is saved.** The field holds what was typed and
 *    the screen shows what it would mean; saving is an explicit act, because a
 *    price that writes a history row on every keystroke would write nine of
 *    them on the way to £12.99.
 *
 * Nothing here can be edited while the fixtures are on: the API refuses the
 * write, because a price edit that appeared to succeed against a mock estate
 * would say "published" and change nothing anywhere.
 */

import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { StyleSheet, Text, TextInput, View } from 'react-native';
import { api, ApiError } from '../../api';
import { Press } from '../../components/press';
import { Icon } from '../../components/Icon';
import { asOneOf, useQueryState, useStickyQuery } from '../../router';
import { BORDER, colors, spacing, type } from '../../theme';
import { useViewport } from '../../hooks/useViewport';
import {
  Band, Bars, Gap, Kv, KvAction, KvField, MeasureTile, Seg, Standing, SuiteHead, SuitePage, SuitePanel,
  TileGrid, Trouble, Waiting, WIDE, onDay,
} from './pieces';
import { SuiteControls, suiteKicker, useFormatters, useSuiteControls } from './useSuite';
import type { Benefit, Subscriptions as Model, Tier } from './model';

/** `round(monthly × 12 × (1 − discount/100))` — the same rule as the server's. */
const annualPence = (monthlyPence: number, discountPct: number) =>
  Math.round(monthlyPence * 12 * (1 - (discountPct || 0) / 100));

const poundsOf = (pence: number | null | undefined) => (pence == null ? '' : (pence / 100).toFixed(2));
const penceOf = (pounds: string) => Math.round((Number(pounds) || 0) * 100);

export function Subscriptions({ canSeeMoney, canManage }: { canSeeMoney: boolean; canManage: boolean }) {
  const { period, setPeriod, source, setSource } = useSuiteControls();
  useStickyQuery('admin.suite.subscriptions', ['tier', 'billing']);
  const [tierKey, setTierKey] = useQueryState<string>('tier', 'household', { read: (r) => r, write: (v) => (v === 'household' ? null : v) });
  const [billing, setBilling] = useQueryState<'monthly' | 'annual'>('billing', 'monthly', asOneOf(['monthly', 'annual'] as const, 'monthly'));

  const [model, setModel] = useState<Model | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [saying, setSaying] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      setModel(await api.adminSuiteSubscriptions({ data: source }));
      setError(null);
    } catch (e: unknown) {
      setError(e instanceof ApiError
        ? (e.status === 403 ? 'The price list is not yours to see. Ask an administrator for view_financials.' : e.message)
        : 'Could not reach Epic.');
    }
  }, [source]);
  useEffect(() => { void load(); }, [load]);

  const fmt = useFormatters(null, null);
  const controls = (
    <SuiteControls period={period} setPeriod={setPeriod} source={source} setSource={setSource}>
      <Seg
        label="Monthly or annual"
        value={billing}
        options={[{ value: 'monthly', label: 'Monthly' }, { value: 'annual', label: 'Annual' }]}
        onChange={setBilling}
      />
    </SuiteControls>
  );

  if (!canSeeMoney) {
    return (
      <SuitePage>
        <SuiteHead title="Subscriptions" right={controls} />
        <Trouble says="The price list is not yours to see. Ask an administrator for view_financials." />
      </SuitePage>
    );
  }
  if (error) {
    return <SuitePage><SuiteHead title="Subscriptions" right={controls} /><Trouble says={error} onRetry={load} /></SuitePage>;
  }
  if (!model) {
    return <SuitePage><SuiteHead title="Subscriptions" right={controls} /><Waiting says="Reading the price list…" /></SuitePage>;
  }

  const tier = model.tiers.find((t) => t.key === tierKey) ?? model.tiers[0];
  const annual = billing === 'annual';

  return (
    <SuitePage>
      <SuiteHead title="Subscriptions" kicker={suiteKicker(source, period)} right={controls} />

      <TileGrid min={230}>
        {model.tiers.map((t) => (
          <TierTile key={t.key} tier={t} annual={annual} selected={t.key === tier?.key} onPress={() => setTierKey(t.key)} />
        ))}
      </TileGrid>

      <Band title={`How ${tier?.label ?? 'a tier'} is sold`}>
        {tier ? (
          <PricePanel
            tier={tier}
            canManage={canManage && source === 'real'}
            mock={source === 'mock'}
            onSaved={async (says) => { setSaying(says); await load(); }}
          />
        ) : null}
        <ChannelPanel model={model} />
        <NetPanel model={model} />
      </Band>

      <BenefitMatrix
        model={model}
        selected={tier?.key ?? 'household'}
        canManage={canManage && source === 'real'}
        onChanged={load}
      />

      <Standing
        items={[
          {
            label: 'MRR',
            value: fmt.revenue.money(model.standing.mrrPence, { pence: true }),
            delta: fmt.revenue.delta(model.standing.mrrDelta) ?? undefined,
            sub: 'a month, at the price each tier is on',
          },
          {
            label: 'Average price paid',
            value: fmt.revenue.money(model.standing.averagePaidPence, { pence: true }),
            gap: 'Nobody is on a priced tier yet',
            delta: fmt.revenue.delta(model.standing.averagePaidDelta) ?? undefined,
            sub: 'a month',
          },
          {
            label: 'On annual',
            value: model.standing.onAnnual == null ? null : `${model.standing.onAnnual} of ${model.standing.onAnnualOf}`,
            gap: model.standing.onAnnualGap,
            sub: model.standing.onAnnualNote ?? undefined,
          },
        ]}
      />

      {saying ? <Text style={type.tiny}>{saying}</Text> : null}
    </SuitePage>
  );
}

// ---------------------------------------------------------------------------

/**
 * A tier tile: the website price as the figure, the App Store price beside it.
 *
 * Two prices on one tile because they are the same product sold two ways, and
 * the difference between them is not a discount — it is Apple's cut. Pro has no
 * subscribers, and the tile says "none yet" rather than showing a nought that
 * reads as a failure.
 */
function TierTile({ tier, annual, selected, onPress }: {
  tier: Tier; annual: boolean; selected: boolean; onPress: () => void;
}) {
  const fmt = useFormatters(null, null);
  const money = (pence: number | null) => fmt.revenue.money(pence, { pence: true });
  const whole = (pence: number | null) => (pence == null ? null : `£${Math.round(pence / 100).toLocaleString()}`);

  const value = annual ? whole(tier.annualWebPence) : money(tier.webPence);
  const sub = annual
    ? `a year on the website · ${tier.discountPct}% off · ${whole(tier.annualIosPence) ?? '—'} in the App Store`
    : `a month on the website · ${money(tier.iosPence) ?? '—'} in the App Store`;

  return (
    <MeasureTile
      label={tier.label}
      value={value}
      gap="No price set"
      sub={sub}
      series={tier.series ?? null}
      selected={selected}
      onPress={onPress}
      footLabel="Subscribers"
      foot={tier.subscribers ? tier.subscribers.toLocaleString() : 'none yet'}
    />
  );
}

/**
 * The price panel: three fields somebody types into, four rows derived from
 * them, and one action that writes them down.
 *
 * The derived rows recalculate on every keystroke — that is the point of having
 * them — but nothing is written until Save. The row above Save says whether
 * there is anything outstanding, so "up to date" and "three changes to save"
 * are the same row rather than two states of a button.
 */
function PricePanel({ tier, canManage, mock, onSaved }: {
  tier: Tier;
  canManage: boolean;
  mock: boolean;
  onSaved: (says: string) => void;
}) {
  const fmt = useFormatters(null, null);
  const [web, setWeb] = useState(poundsOf(tier.webPence));
  const [ios, setIos] = useState(poundsOf(tier.iosPence));
  const [disc, setDisc] = useState(String(tier.discountPct ?? 0));
  const [busy, setBusy] = useState(false);
  const [trouble, setTrouble] = useState<string | null>(null);

  // A different tier is a different set of prices: the fields follow the tile.
  useEffect(() => {
    setWeb(poundsOf(tier.webPence));
    setIos(poundsOf(tier.iosPence));
    setDisc(String(tier.discountPct ?? 0));
    setTrouble(null);
  }, [tier.key, tier.webPence, tier.iosPence, tier.discountPct]);

  const webPence = penceOf(web);
  const iosPence = penceOf(ios);
  const discPct = Number(disc) || 0;

  const dirty = useMemo(() => (
    webPence !== (tier.webPence ?? 0)
    || iosPence !== (tier.iosPence ?? 0)
    || discPct !== (tier.discountPct ?? 0)
  ), [webPence, iosPence, discPct, tier]);

  const money = (pence: number) => fmt.revenue.money(pence, { pence: true });
  const whole = (pence: number) => `£${Math.round(pence / 100).toLocaleString()}`;

  const save = async () => {
    setBusy(true);
    setTrouble(null);
    try {
      // Three channels, three rows — but only the ones that actually changed,
      // so a discount edit does not stamp a new App Store price as well.
      if (webPence !== (tier.webPence ?? 0) || discPct !== (tier.discountPct ?? 0)) {
        await api.adminSetTierPrice({ planKey: tier.key, channel: 'web', amountPence: webPence, discountPct: discPct });
      }
      if (iosPence !== (tier.iosPence ?? 0) || discPct !== (tier.discountPct ?? 0)) {
        await api.adminSetTierPrice({ planKey: tier.key, channel: 'ios', amountPence: iosPence, discountPct: discPct });
      }
      onSaved(`${tier.label} priced at ${money(webPence)} a month on the website. The old row is closed, not overwritten.`);
    } catch (e: unknown) {
      setTrouble(e instanceof ApiError ? e.message : 'Could not reach Epic.');
    } finally {
      setBusy(false);
    }
  };

  return (
    <SuitePanel
      title={`Price · ${tier.label}`}
      note="Changing a price writes a new price row. Existing subscriptions keep the row they were sold on."
      grow={1.1}
    >
      <KvField label="Monthly on the website, £" value={web} onChange={setWeb} prefix="£" />
      <KvField label="Monthly in the App Store, £" value={ios} onChange={setIos} prefix="£" />
      <KvField label="Annual discount, %" value={disc} onChange={setDisc} suffix="%" width={80} />

      <Kv
        label="Annual works out at"
        value={`${whole(annualPence(webPence, discPct))} web · ${whole(annualPence(iosPence, discPct))} App Store`}
      />
      <Kv
        label="App Store uplift"
        value={webPence ? `${Math.round((iosPence / webPence - 1) * 100)}% · covers a 15% cut` : null}
        gap="No website price to compare with"
      />
      <Kv
        label="Revenue at this price"
        // Whole pounds: what the tier is worth a month at this price, which is a
        // figure at the scale of thousands rather than a price to the penny.
        value={tier.subscribers ? `£${Math.round((tier.subscribers * webPence) / 100).toLocaleString()} a month` : null}
        gap="Nobody is on this tier yet"
      />
      <Kv label="Subscribers" value={tier.subscribers ? tier.subscribers.toLocaleString() : 'none yet'} strong />

      {mock ? (
        <Kv label="Mock data is on" value="Nothing to save" gap="Turn mock data off to change a price" last />
      ) : !canManage ? (
        <Kv label="Setting a price" value={null} gap="Needs manage_plans" last />
      ) : (
        <KvAction
          label={dirty ? 'Unpublished changes' : `Set ${tier.priceSetAt ? on(tier.priceSetAt) : 'at the start'}`}
          action={busy ? 'Saving…' : dirty ? 'Publish' : 'Up to date'}
          done={!dirty || busy}
          onPress={save}
          last
        />
      )}
      {trouble ? <Text style={styles.trouble}>{trouble}</Text> : null}
    </SuitePanel>
  );
}

const on = (iso: string) => onDay(iso) ?? '—';

/** Where they bought it, and what the channel kept. */
function ChannelPanel({ model }: { model: Model }) {
  const fmt = useFormatters(null, null);
  const money = (pence: number | null) => fmt.revenue.money(pence, { pence: true });
  return (
    <SuitePanel title="Where they bought it" note={model.channels.note ?? undefined}>
      {model.channels.rows.map((r) => (
        <Kv
          key={r.key}
          label={r.label}
          value={r.subscribers == null ? null : `${r.subscribers.toLocaleString()} · ${money(r.pence) ?? '—'}`}
          gap={r.key === 'android' ? 'Not launched' : 'No payment provider'}
        />
      ))}
      {model.channels.rows.filter((r) => r.feePence != null).map((r, i, all) => (
        <Kv
          key={`fee-${r.key}`}
          label={r.key === 'ios' ? 'Fees to Apple · 15%' : 'Fees to Stripe'}
          value={`−${money(r.feePence) ?? '—'}`}
          strong={i === all.length - 1}
          last={i === all.length - 1}
        />
      ))}
      {model.channels.rows.every((r) => r.feePence == null) ? (
        <Kv label="Fees" value={null} gap="No payment provider" last />
      ) : null}
    </SuitePanel>
  );
}

/** What Epic actually keeps, by channel. */
function NetPanel({ model }: { model: Model }) {
  const fmt = useFormatters(null, null);
  const money = (pence: number | null) => fmt.revenue.money(pence, { pence: true });
  const c = model.channels;
  return (
    <SuitePanel title="Net to Epic by channel">
      {c.net?.length
        ? <Bars rows={c.net} format={(v) => (typeof v === 'number' ? fmt.revenue.money(v) : v == null ? null : String(v))} />
        : <Gap says="No payment provider — nothing has been collected or netted" />}
      <Kv label="Blended fee rate" value={c.blendedFeePct == null ? null : `${c.blendedFeePct}%`} gap="No payment provider" />
      <Kv
        label="If everyone used Apple"
        value={c.ifEveryoneUsedApplePence == null ? null : `${money(c.ifEveryoneUsedApplePence)} a month`}
        gap="No payment provider"
      />
      <Kv label="MRR after fees" value={money(c.mrrAfterFeesPence ?? null)} gap="No payment provider" strong lime last />
    </SuitePanel>
  );
}

// ---------------------------------------------------------------------------

/**
 * The benefits matrix — a table where every cell is a field.
 *
 * This is what a household is *told* it gets, so it is published rather than
 * computed: the entitlement engine decides what a plan actually grants, and
 * these are the words on the pricing page. The selected tier's column is lime,
 * which is how the screen says which one the panels above are about without a
 * sentence explaining it.
 *
 * A cell saves when it loses focus rather than on every keystroke, so typing
 * "Unlimited" is one write and not ten.
 */
function BenefitMatrix({ model, selected, canManage, onChanged }: {
  model: Model; selected: string; canManage: boolean; onChanged: () => void | Promise<void>;
}) {
  const { width } = useViewport();
  const tiers = model.tiers;
  const [fresh, setFresh] = useState('');
  const [busy, setBusy] = useState(false);
  const [trouble, setTrouble] = useState<string | null>(null);

  const guard = async (work: () => Promise<unknown>) => {
    setBusy(true);
    setTrouble(null);
    try { await work(); await onChanged(); } catch (e: unknown) {
      setTrouble(e instanceof ApiError ? e.message : 'Could not reach Epic.');
    } finally { setBusy(false); }
  };

  const add = () => {
    const label = fresh.trim();
    if (!label) return;
    setFresh('');
    void guard(() => api.adminAddBenefit({ label, values: Object.fromEntries(tiers.map((t) => [t.key, '—'])) }));
  };

  return (
    <View style={{ gap: spacing.md }}>
      <View style={styles.matrixHead}>
        <Text style={styles.matrixTitle}>WHAT THEY GET{canManage ? ' · EDIT ANY CELL' : ''}</Text>
        <View style={{ flex: 1 }} />
        {model.unpublished > 0 ? (
          <Press
            effect="none"
            onPress={() => guard(() => api.adminPublishBenefits())}
            accessibilityRole="button"
            accessibilityLabel="Publish the benefits"
            style={styles.publish}
          >
            <Text style={styles.publishText}>
              {busy ? 'Publishing…' : `Publish ${model.unpublished} ${model.unpublished === 1 ? 'change' : 'changes'}`}
            </Text>
          </Press>
        ) : (
          <Text style={type.tiny}>{model.publishedAt ? `Published ${on(model.publishedAt)}` : 'Never published'}</Text>
        )}
      </View>

      <View style={{ minWidth: 0 }}>
        <View style={styles.matrixRow}>
          <Text style={[styles.matrixCol, { flexGrow: 1, flexBasis: 200, textAlign: 'left' }]}>BENEFIT</Text>
          {tiers.map((t) => (
            <Text
              key={t.key}
              style={[styles.matrixCol, { width: width >= WIDE ? 130 : 96 }, t.key === selected && { color: colors.lime }]}
              // Two lines on a phone: "HOUSEHOLD" at 9.5px/800 with letter
              // spacing does not fit 96px on one, and a clipped column heading
              // is worse than a wrapped one (20 Sep 2026).
              numberOfLines={2}
            >
              {t.label.toUpperCase()}
            </Text>
          ))}
          {canManage ? <Text style={[styles.matrixCol, { width: 70 }]} /> : null}
        </View>

        {model.benefits.map((b) => (
          <BenefitRow
            key={b.id}
            benefit={b}
            tiers={tiers}
            selected={selected}
            canManage={canManage}
            onChanged={onChanged}
          />
        ))}

        {canManage ? (
          <View style={styles.addRow}>
            <View style={styles.addField}>
              <TextInput
                value={fresh}
                onChangeText={setFresh}
                onSubmitEditing={add}
                placeholder="Another benefit"
                placeholderTextColor={colors.inkMuted}
                accessibilityLabel="A new benefit"
                style={styles.addInput as any}
              />
            </View>
            {/* The control adds it, not the row — a row that saved itself on
                blur would add an empty benefit every time somebody tabbed past. */}
            <Press effect="none" onPress={add} accessibilityRole="button" style={{ width: width >= WIDE ? 130 : 96, alignItems: 'center' }}>
              <Text style={styles.addAction}>Add a benefit</Text>
            </Press>
          </View>
        ) : null}
      </View>

      {trouble ? <Text style={styles.trouble}>{trouble}</Text> : null}
    </View>
  );
}

function BenefitRow({ benefit, tiers, selected, canManage, onChanged }: {
  benefit: Benefit;
  tiers: Tier[];
  selected: string;
  canManage: boolean;
  onChanged: () => void | Promise<void>;
}) {
  const { width } = useViewport();
  const [label, setLabel] = useState(benefit.label);
  const [values, setValues] = useState<Record<string, string>>(benefit.values);

  useEffect(() => { setLabel(benefit.label); setValues(benefit.values); }, [benefit]);

  const cellWidth = width >= WIDE ? 130 : 96;

  // On blur, and only if something actually changed: tabbing across a row
  // should not write five identical rows to the audit trail.
  const commit = async () => {
    const same = label === benefit.label && tiers.every((t) => (values[t.key] ?? '') === (benefit.values[t.key] ?? ''));
    if (same) return;
    try { await api.adminSetBenefit(benefit.id, { label, values }); await onChanged(); } catch { /* the panel says it */ }
  };

  return (
    <View style={styles.matrixRow}>
      {canManage ? (
        <View style={[styles.cellField, { flexGrow: 1, flexBasis: 200 }]}>
          <TextInput
            value={label}
            onChangeText={setLabel}
            onBlur={commit}
            accessibilityLabel="The benefit"
            style={[styles.cellInput, { textAlign: 'left' }] as any}
          />
        </View>
      ) : (
        <Text style={[styles.readCell, { flexGrow: 1, flexBasis: 200, textAlign: 'left', color: colors.ink }]} numberOfLines={2}>{label}</Text>
      )}

      {tiers.map((t) => {
        const on2 = t.key === selected;
        if (!canManage) {
          return (
            <Text key={t.key} style={[styles.readCell, { width: cellWidth }, on2 && { color: colors.lime, fontWeight: '700' }]} numberOfLines={1}>
              {values[t.key] ?? '—'}
            </Text>
          );
        }
        return (
          <View key={t.key} style={[styles.cellField, { width: cellWidth }, on2 && { borderColor: colors.ruleMuted }]}>
            <TextInput
              value={values[t.key] ?? ''}
              onChangeText={(v) => setValues((was) => ({ ...was, [t.key]: v }))}
              onBlur={commit}
              accessibilityLabel={`${label} — ${t.label}`}
              style={[styles.cellInput, on2 && { color: colors.lime, fontWeight: '700' }] as any}
            />
          </View>
        );
      })}

      {canManage ? (
        <Press
          effect="none"
          onPress={async () => { try { await api.adminRemoveBenefit(benefit.id); await onChanged(); } catch { /* the panel says it */ } }}
          accessibilityRole="button"
          accessibilityLabel={`Remove ${label}`}
          style={{ width: 70, alignItems: 'center' }}
        >
          <Icon name="close" size={13} color={colors.inkMuted} />
        </Press>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  matrixHead: {
    flexDirection: 'row', alignItems: 'flex-end', gap: spacing.md,
    borderTopWidth: BORDER, borderTopColor: colors.lime, paddingTop: 9,
  },
  matrixTitle: { fontFamily: type.title.fontFamily, fontSize: 10, fontWeight: '800', letterSpacing: 1, color: colors.lime },
  publish: { borderBottomWidth: 1.5, borderBottomColor: colors.lime },
  publishText: { ...type.small, fontSize: 12.5, color: colors.lime, fontWeight: '700' },

  matrixRow: {
    flexDirection: 'row', alignItems: 'center', gap: 10,
    paddingVertical: 6, borderBottomWidth: 1, borderBottomColor: colors.lineSoft,
  },
  matrixCol: {
    fontFamily: type.title.fontFamily, fontSize: 9.5, fontWeight: '800', letterSpacing: 0.76,
    color: colors.inkMuted, textAlign: 'center',
  },
  readCell: { ...type.small, fontSize: 13.5, color: colors.mutedOnInk, textAlign: 'center' },
  cellField: { borderWidth: 1, borderColor: colors.lineSoft, paddingVertical: 4, paddingHorizontal: 6 },
  cellInput: {
    backgroundColor: 'transparent', borderWidth: 0, textAlign: 'center',
    color: colors.ink, fontFamily: type.body.fontFamily, fontSize: 13,
  },

  addRow: {
    flexDirection: 'row', alignItems: 'center', gap: 10,
    paddingVertical: 10, borderBottomWidth: BORDER, borderBottomColor: colors.ruleMuted,
  },
  addField: {
    flexGrow: 1, flexBasis: 200, borderWidth: 1, borderColor: colors.ruleMuted, borderStyle: 'dashed',
    paddingVertical: 5, paddingHorizontal: 9,
  },
  addInput: {
    backgroundColor: 'transparent', borderWidth: 0,
    color: colors.ink, fontFamily: type.body.fontFamily, fontSize: 13.5,
  },
  addAction: { ...type.small, fontSize: 12, fontWeight: '800', color: colors.lime },

  trouble: { ...type.small, fontSize: 12.5, color: colors.overrun },
});

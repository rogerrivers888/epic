/**
 * Rows — the long scrollable list a household actually browses.
 *
 * A row is a **title, a copy line and a rule**, and never a drawer anything is
 * filed into. Nothing is ever put in a row; a row asks a question of every
 * place and shows what answers. That is why the three fields edit separately —
 * the first real test of "Sneakily educational" is a household reading it, and
 * the title has to be changeable without touching what it returns.
 *
 * Hearting a row is the highest-signal tap in the product, which is why the
 * back office shows the fill per district beside it. A rule returning fourteen
 * places in Ascot returns two in Hungerford, and a row nobody can fill is not
 * a bad row — it is a row waiting for a district to get denser.
 */

import React, { useState } from 'react';
import { Image, Text, TextInput, View } from 'react-native';

import { Icon } from '../../components/Icon';
import { Press } from '../../components/press';
import { LIME, ON_LIME, desk, fonts, house } from '../../theme';
import { Act, Band, Kicker, Nothing, Value } from './desk';
import type { BrowseRow, District, Member } from './types';

// ---------------------------------------------------------------------------
// The back office list
// ---------------------------------------------------------------------------

export type RowFilter = 'all' | 'hearted' | 'thin' | 'cold';

const FILTERS: { key: RowFilter; name: string }[] = [
  { key: 'all', name: 'Everything' },
  { key: 'hearted', name: 'Hearted' },
  { key: 'thin', name: 'Thin in a district' },
  { key: 'cold', name: 'Nobody hearts it' },
];

export function Rows({
  rows, districts, minFill, filter, onFilter, onHeart, onEdit, household,
}: {
  rows: BrowseRow[];
  districts: District[];
  /** Places a row needs in a district before a household is shown it. */
  minFill: number;
  filter: RowFilter;
  onFilter: (f: RowFilter) => void;
  onHeart: (id: string) => void;
  onEdit: (id: string, field: 'title' | 'copy' | 'rule', value: string) => void;
  /** The household this list is being previewed for. */
  household: string;
}) {
  const [open, setOpen] = useState<string | null>(null);
  const [editing, setEditing] = useState<{ id: string; field: 'title' | 'copy' | 'rule' } | null>(null);

  const hearted = rows.filter((r) => r.hearted).length;
  const thin = rows.filter((r) => r.thin).length;
  const cold = rows.filter((r) => r.share == null).length;

  const shown = rows.filter((r) => {
    if (filter === 'hearted') return r.hearted;
    if (filter === 'thin') return r.thin;
    if (filter === 'cold') return r.share == null;
    return true;
  });

  return (
    <>
      <Band
        title={`${rows.length} rows · ${household}`}
        stats={[
          { label: 'Hearted here', value: hearted, strong: true },
          { label: 'Below minimum fill', value: thin, strong: true },
          { label: 'Nobody has hearted', value: cold },
        ]}
      />

      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 26, flexWrap: 'wrap' }}>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 12 }}>
          <Kicker>Show</Kicker>
          {FILTERS.map((f) => (
            <Act key={f.key} label={f.name} tone={f.key === filter ? 'ink' : 'dim'}
              ruled={f.key === filter} onPress={() => onFilter(f.key)} />
          ))}
        </View>
        <Value tone="dim" size={12}>
          {`title, copy and rule are three separate things — click any of them · previewed in ${districts.length} districts · ${districts.map((d) => `${d.code} ${d.density}`).join(' · ')}`}
        </Value>
      </View>

      <View>
        {/* The header carries the district codes, because the columns are areas. */}
        <View style={{
          flexDirection: 'row', alignItems: 'center', gap: 18,
          borderBottomWidth: 2, borderBottomColor: desk.ruleStrong,
          paddingHorizontal: 8, paddingBottom: 9,
        }}>
          <View style={{ width: 44, flexGrow: 0, flexShrink: 0 }} />
          <View style={{ width: 280, flexGrow: 0, flexShrink: 0 }}>
            <Value size={12.5} weight="600" tone="dim">Row</Value>
          </View>
          <View style={{ flex: 1, minWidth: 0 }}>
            <Value size={12.5} weight="600" tone="dim">The rule</Value>
          </View>
          <View style={{ width: 240, flexGrow: 0, flexShrink: 0, flexDirection: 'row', gap: 8, justifyContent: 'flex-end' }}>
            {districts.map((d) => (
              <View key={d.code} style={{ width: 72, alignItems: 'flex-end' }}>
                <Value size={12.5} weight="600" tone="dim">{d.code}</Value>
              </View>
            ))}
          </View>
          <View style={{ width: 170, flexGrow: 0, flexShrink: 0, alignItems: 'flex-end' }}>
            <Value size={12.5} weight="600" tone="dim">Households hearting</Value>
          </View>
        </View>

        {shown.length === 0 ? <Nothing>No rows match that.</Nothing> : null}
        {shown.map((r) => {
          const isOpen = open === r.id;
          const ed = (f: 'title' | 'copy' | 'rule') => editing?.id === r.id && editing.field === f;
          return (
            <View key={r.id} style={{
              borderBottomWidth: 1, borderBottomColor: desk.rule,
              backgroundColor: r.hearted ? desk.lifted : 'transparent',
            }}>
              <View style={{ flexDirection: 'row', alignItems: 'flex-start', gap: 18, paddingVertical: 12, paddingHorizontal: 8 }}>
                {/* The heart does not open the row. */}
                <Press effect="pop" onPress={() => onHeart(r.id)} accessibilityRole="button"
                  accessibilityLabel={r.hearted ? `Unheart ${r.title}` : `Heart ${r.title}`}
                  style={{ width: 44, flexGrow: 0, flexShrink: 0 }}>
                  <Icon name="favourite" size={17} color={r.hearted ? LIME : desk.inkFaint}
                    fill={r.hearted} fillColor={LIME} />
                </Press>

                <View style={{ width: 280, flexGrow: 0, flexShrink: 0, minWidth: 0, gap: 3 }}>
                  {ed('title') ? (
                    <Edit value={r.title} weight="700" size={13.5}
                      onChange={(v) => onEdit(r.id, 'title', v)} onDone={() => setEditing(null)} />
                  ) : (
                    <Press effect="none" accessibilityRole="button"
                      onPress={() => setEditing({ id: r.id, field: 'title' })}>
                      <Value weight="700">{r.title}</Value>
                    </Press>
                  )}
                  {ed('copy') ? (
                    <Edit value={r.copy} size={12} placeholder="a copy line, if it needs one"
                      onChange={(v) => onEdit(r.id, 'copy', v)} onDone={() => setEditing(null)} />
                  ) : (
                    <Press effect="none" accessibilityRole="button"
                      onPress={() => setEditing({ id: r.id, field: 'copy' })}>
                      <Value size={12} tone={r.copy ? 'dim' : 'faint'}>{r.copy || 'no copy line'}</Value>
                    </Press>
                  )}
                </View>

                <View style={{ flex: 1, minWidth: 0 }}>
                  {ed('rule') ? (
                    <Edit value={r.rule} size={12.5}
                      onChange={(v) => onEdit(r.id, 'rule', v)} onDone={() => setEditing(null)} />
                  ) : (
                    <Press effect="none" accessibilityRole="button"
                      onPress={() => setEditing({ id: r.id, field: 'rule' })}>
                      <Value size={12.5} tone="muted">{r.rule}</Value>
                    </Press>
                  )}
                </View>

                {/* Clicking anywhere else on the row opens it. */}
                <Press effect="none" accessibilityRole="button" accessibilityState={{ expanded: isOpen }}
                  onPress={() => setOpen(isOpen ? null : r.id)}
                  style={{ width: 240, flexGrow: 0, flexShrink: 0 }}>
                  <View style={{ flexDirection: 'row', gap: 8, justifyContent: 'flex-end' }}>
                    {districts.map((d) => {
                      const n = r.fill[d.code]?.count ?? 0;
                      const low = n < minFill;
                      return (
                        <View key={d.code} style={{ width: 72, alignItems: 'flex-end' }}>
                          <Value numeric tone={low ? 'warn' : 'ink'} weight={low ? '800' : '400'}>{n}</Value>
                        </View>
                      );
                    })}
                  </View>
                </Press>

                <Press effect="none" accessibilityRole="button"
                  onPress={() => setOpen(isOpen ? null : r.id)}
                  style={{ width: 170, flexGrow: 0, flexShrink: 0 }}>
                  <View style={{ alignItems: 'flex-end' }}>
                    {/*
                      A share nobody has contributed to is not 0% — it is
                      "nobody yet", which is a fact about the product's age
                      rather than about the row.
                    */}
                    <Value numeric tone={r.share == null ? 'warn' : 'muted'} size={13}>
                      {r.share == null ? 'nobody yet' : `${Math.round(r.share * 100)}%`}
                    </Value>
                  </View>
                </Press>
              </View>

              {isOpen ? (
                <View style={{ gap: 11, paddingLeft: 62, paddingRight: 8, paddingBottom: 18 }}>
                  {districts.map((d) => {
                    const f = r.fill[d.code] ?? { count: 0, places: [] };
                    const low = f.count < minFill;
                    return (
                      <View key={d.code} style={{ flexDirection: 'row', alignItems: 'flex-start', gap: 16 }}>
                        <View style={{ width: 150, flexGrow: 0, flexShrink: 0 }}>
                          <Value size={12.5} weight="700" tone={low ? 'warn' : 'ink'}>
                            {`${d.code} · ${f.count}`}
                          </Value>
                          <Value size={11} tone="dim">{`${d.town} · ${d.density}`}</Value>
                        </View>
                        <View style={{ flex: 1, minWidth: 0, flexDirection: 'row', flexWrap: 'wrap', gap: 7 }}>
                          {f.places.slice(0, 6).map((p) => (
                            <View key={p} style={{ borderWidth: 1, borderColor: desk.ruleStrong, paddingVertical: 4, paddingHorizontal: 9 }}>
                              <Value tone="muted" size={12}>{p}</Value>
                            </View>
                          ))}
                          {f.places.length > 6 ? (
                            <View style={{ paddingVertical: 4, paddingHorizontal: 2 }}>
                              <Value tone="dim" size={12}>{`and ${f.places.length - 6} more`}</Value>
                            </View>
                          ) : null}
                          {f.count === 0 ? (
                            <View style={{ paddingVertical: 4, paddingHorizontal: 2 }}>
                              <Value tone="dim" size={12}>nothing here — the row waits quietly</Value>
                            </View>
                          ) : null}
                        </View>
                      </View>
                    );
                  })}
                </View>
              ) : null}
            </View>
          );
        })}
      </View>
    </>
  );
}

/** Click text, get a field. Enter commits, Escape cancels. */
function Edit({ value, onChange, onDone, size, weight = '400', placeholder }: {
  value: string;
  onChange: (v: string) => void;
  onDone: () => void;
  size: number;
  weight?: '400' | '700';
  placeholder?: string;
}) {
  const [draft, setDraft] = useState(value);
  return (
    <TextInput
      value={draft}
      autoFocus
      onChangeText={setDraft}
      placeholder={placeholder}
      placeholderTextColor={desk.inkFaint}
      onBlur={() => { onChange(draft); onDone(); }}
      onSubmitEditing={() => { onChange(draft); onDone(); }}
      onKeyPress={(e) => {
        // Escape throws the draft away; Enter is handled by onSubmitEditing.
        if ((e.nativeEvent as { key?: string }).key === 'Escape') onDone();
      }}
      style={{
        width: '100%',
        backgroundColor: desk.well,
        borderWidth: 1.5,
        borderColor: LIME,
        color: weight === '700' ? desk.ink : desk.inkMuted,
        fontFamily: fonts.body,
        fontSize: size,
        fontWeight: weight,
        paddingVertical: 6,
        paddingHorizontal: 8,
        outlineStyle: 'none',
      } as never}
    />
  );
}

// ---------------------------------------------------------------------------
// The household view
// ---------------------------------------------------------------------------

export type HouseState = 'list' | 'first' | 'inspire' | 'thin' | 'named';

const STATES: { key: HouseState; name: string }[] = [
  { key: 'list', name: 'The list' },
  { key: 'first', name: 'First heart' },
  { key: 'inspire', name: 'Inspire' },
  { key: 'thin', name: 'Waiting row' },
  { key: 'named', name: 'Named rows' },
];

const SAYS: Record<HouseState, string> = {
  list: 'Forty rows, scrollable, hearts inline. A row is a title and a rule — nothing is ever filed into one.',
  first: 'The first heart asks whose list this is. One tap, sticky, never asked again in the session.',
  inspire: 'Hearted rows rise to the top, and two or three unhearted ones stay mixed in so discovery does not stop.',
  thin: 'A hearted row below minimum fill waits quietly rather than showing an empty shelf.',
  named: 'Personalised naming as a pattern: the adult’s own day, and a child’s name only ever attached to something positive.',
};

/**
 * The household preview.
 *
 * A 390px cream column, not a device frame — it documents content and ordering,
 * not chrome (handoff, "Fidelity"). It is the only light surface in the back
 * office, and the only one with rounded corners: photographs at 8px and member
 * avatars circular, because they are the two things that are not type.
 */
export function HouseholdView({
  state, onState, districts, district, onDistrict, rows, members, owner, minFill, hearts,
  onHeart, onOwner,
}: {
  state: HouseState;
  onState: (s: HouseState) => void;
  districts: District[];
  district: string;
  onDistrict: (code: string) => void;
  /** Already ordered for the state being shown. */
  rows: (BrowseRow & { shelf: { name: string; photo: string | null }[] })[];
  members: Member[];
  owner: Member | null;
  minFill: number;
  /** Every heart, with who set it and how old it is. */
  hearts: { id: string; title: string; who: string; days: number }[];
  onHeart: (id: string) => void;
  onOwner: (memberId: string) => void;
}) {
  const here = districts.find((d) => d.code === district) ?? districts[0];
  const askWho = state === 'first' && !owner;

  return (
    <>
      <View style={{
        flexDirection: 'row', alignItems: 'center', gap: 20,
        borderBottomWidth: 2, borderBottomColor: desk.ruleStrong, paddingBottom: 16,
      }}>
        <View style={{ flex: 1 }}>
          <Text style={{
            fontFamily: fonts.heading, fontSize: 31, fontWeight: '800',
            letterSpacing: -1.085, lineHeight: 32, color: desk.ink,
          }}>
            What the household sees
          </Text>
        </View>
        <View style={{ flexDirection: 'row', borderWidth: 1, borderColor: desk.ruleStrong }}>
          {STATES.map((s, i) => {
            const on = s.key === state;
            return (
              <Press key={s.key} effect="none" onPress={() => onState(s.key)} accessibilityRole="tab"
                accessibilityState={{ selected: on }}>
                <View style={{
                  paddingVertical: 9, paddingHorizontal: 18,
                  backgroundColor: on ? LIME : 'transparent',
                  borderLeftWidth: i ? 1 : 0, borderLeftColor: desk.ruleStrong,
                }}>
                  <Text style={{
                    fontFamily: fonts.body, fontSize: 12.5, fontWeight: on ? '700' : '600',
                    color: on ? ON_LIME : desk.inkDim,
                  }}>
                    {s.name}
                  </Text>
                </View>
              </Press>
            );
          })}
        </View>
      </View>

      <View style={{ flexDirection: 'row', gap: 40, alignItems: 'flex-start' }}>
        <View style={{
          width: 390, flexGrow: 0, flexShrink: 0,
          backgroundColor: house.ground, borderWidth: 1, borderColor: desk.rule,
        }}>
          <View style={{
            flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
            paddingTop: 16, paddingHorizontal: 18, paddingBottom: 12,
          }}>
            <Text style={{
              fontFamily: fonts.heading, fontSize: 19, fontWeight: '800',
              letterSpacing: -0.57, color: house.ink,
            }}>
              {state === 'inspire' ? 'Inspire' : 'Rows'}
            </Text>
            {owner ? (
              <Text style={{ fontFamily: fonts.body, fontSize: 12.5, fontWeight: '700', color: house.inkMuted }}>
                {`${owner.name}’s hearts`}
              </Text>
            ) : null}
          </View>

          <View style={{
            flexDirection: 'row',
            borderTopWidth: 1, borderTopColor: house.rule,
            borderBottomWidth: 1, borderBottomColor: house.rule,
          }}>
            {districts.map((d, i) => {
              const on = d.code === district;
              return (
                <Press key={d.code} effect="none" onPress={() => onDistrict(d.code)} accessibilityRole="button"
                  accessibilityState={{ selected: on }} style={{ flex: 1 }}>
                  <View style={{
                    paddingVertical: 9, paddingHorizontal: 8, gap: 1,
                    backgroundColor: on ? house.ink : 'transparent',
                    borderLeftWidth: i ? 1 : 0, borderLeftColor: house.rule,
                  }}>
                    <Text style={{
                      fontFamily: fonts.body, fontSize: 12, fontWeight: '800',
                      color: on ? house.ground : house.ink,
                    }}>
                      {d.code}
                    </Text>
                    <Text style={{ fontFamily: fonts.body, fontSize: 11, color: on ? house.rule : house.inkMuted }}>
                      {`${d.town} · ${d.density}`}
                    </Text>
                  </View>
                </Press>
              );
            })}
          </View>

          {askWho ? (
            <View style={{
              gap: 12, paddingTop: 14, paddingHorizontal: 18, paddingBottom: 18,
              borderTopWidth: 1, borderTopColor: house.rule,
              borderBottomWidth: 1, borderBottomColor: house.rule,
              backgroundColor: house.warm,
            }}>
              <Text style={{ fontFamily: fonts.body, fontSize: 16, fontWeight: '700', color: house.ink, lineHeight: 20.8 }}>
                Whose list is this?
              </Text>
              <View style={{ flexDirection: 'row', gap: 10 }}>
                {members.map((m) => (
                  <Press key={m.id} effect="sink" onPress={() => onOwner(m.id)} accessibilityRole="button"
                    style={{ flex: 1 }}>
                    <View style={{ alignItems: 'center', gap: 6 }}>
                      <View style={{
                        width: 48, height: 48, borderRadius: 24,
                        borderWidth: 2, borderColor: house.ink,
                        alignItems: 'center', justifyContent: 'center',
                      }}>
                        <Text style={{
                          fontFamily: fonts.heading, fontSize: 17, fontWeight: '800', color: house.ink,
                        }}>
                          {m.name.slice(0, 1)}
                        </Text>
                      </View>
                      <Text style={{ fontFamily: fonts.body, fontSize: 12.5, fontWeight: '600', color: house.ink }}>
                        {m.role === 'child' && m.age != null ? `${m.name} · ${m.age}` : m.name}
                      </Text>
                    </View>
                  </Press>
                ))}
              </View>
              <Text style={{ fontFamily: fonts.body, fontSize: 12.5, color: house.inkMuted }}>
                Asked once. Every heart after this is attributed to them.
              </Text>
            </View>
          ) : null}

          <View style={{ paddingTop: 2, paddingBottom: 20 }}>
            {rows.map((r) => {
              const fill = r.fill[district]?.count ?? 0;
              const waiting = r.hearted && fill < minFill;
              return (
                <View key={r.id} style={{
                  gap: 3, paddingVertical: 11, paddingHorizontal: 18,
                  borderBottomWidth: 1, borderBottomColor: house.ruleSoft,
                  backgroundColor: r.hearted ? house.warm : 'transparent',
                }}>
                  <View style={{ flexDirection: 'row', alignItems: 'flex-start', gap: 12 }}>
                    <View style={{ flex: 1, minWidth: 0, gap: 3 }}>
                      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
                        <Text style={{
                          fontFamily: fonts.heading, fontSize: 16.5, fontWeight: '800',
                          letterSpacing: -0.33, color: house.ink,
                        }}>
                          {r.title}
                        </Text>
                        {waiting ? (
                          <View style={{ borderWidth: 1, borderColor: house.inkMuted, paddingVertical: 1, paddingHorizontal: 5 }}>
                            <Text style={{
                              fontFamily: fonts.body, fontSize: 9.5, fontWeight: '800',
                              letterSpacing: 0.4, color: house.inkMuted,
                            }}>
                              WAITING
                            </Text>
                          </View>
                        ) : null}
                      </View>
                      <Text style={{ fontFamily: fonts.body, fontSize: 13, color: house.inkMuted, lineHeight: 18.2 }}>
                        {waiting
                          ? 'Nothing near you this week — it comes back when there is'
                          : r.copy || `${fill} places near ${here?.town ?? ''}`}
                      </Text>
                    </View>
                    {/* The loved heart is ink now, not red (owner, 7 Sep 2026). */}
                    <Press effect="pop" onPress={() => onHeart(r.id)} accessibilityRole="button"
                      accessibilityLabel={r.hearted ? `Unheart ${r.title}` : `Heart ${r.title}`}
                      style={{ paddingTop: 2 }}>
                      <Icon name="favourite" size={21} color={house.ink} fill={r.hearted} fillColor={house.ink} />
                    </Press>
                  </View>
                  {/*
                    A waiting row shows no shelf at all. An empty shelf reads as
                    "there is nothing good here"; no shelf reads as "not this
                    week", which is what is true.
                  */}
                  {r.hearted && !waiting && r.shelf.length ? (
                    <View style={{ flexDirection: 'row', gap: 8, paddingTop: 7 }}>
                      {r.shelf.slice(0, 3).map((p) => (
                        <View key={p.name} style={{ width: 106, flexGrow: 0, flexShrink: 0, gap: 5 }}>
                          <View style={{
                            width: 106, height: 74, borderRadius: 8,
                            backgroundColor: house.rule, overflow: 'hidden',
                          }}>
                            {p.photo ? (
                              <Image source={{ uri: p.photo }} style={{ width: 106, height: 74 }} resizeMode="cover" />
                            ) : null}
                          </View>
                          <Text style={{
                            fontFamily: fonts.body, fontSize: 11.5, fontWeight: '600',
                            color: house.ink, lineHeight: 14.4,
                          }}>
                            {p.name}
                          </Text>
                        </View>
                      ))}
                    </View>
                  ) : null}
                </View>
              );
            })}
          </View>
        </View>

        <View style={{ flex: 1, minWidth: 0, gap: 13 }}>
          <Kicker>What this state shows</Kicker>
          <Text style={{ fontFamily: fonts.body, fontSize: 13, color: desk.inkMuted, lineHeight: 20.8 }}>
            {SAYS[state]}
          </Text>
          <View style={{ gap: 9, borderTopWidth: 1, borderTopColor: desk.rule, paddingTop: 14 }}>
            {hearts.length === 0 ? <Nothing>Nothing is hearted yet.</Nothing> : null}
            {hearts.map((h) => {
              // A heart that has sat untouched for months is fading: it was
              // true once and may not be now.
              const fading = h.days > 120;
              return (
                <View key={h.id} style={{
                  flexDirection: 'row', alignItems: 'center', gap: 14,
                  paddingBottom: 9, borderBottomWidth: 1, borderBottomColor: desk.rule,
                }}>
                  <View style={{ width: 230, flexGrow: 0, flexShrink: 0 }}>
                    <Value size={13} weight="700">{h.title}</Value>
                  </View>
                  <View style={{ width: 110, flexGrow: 0, flexShrink: 0 }}>
                    <Value size={12.5} tone="muted">{h.who}</Value>
                  </View>
                  <View style={{ flex: 1, minWidth: 0 }}>
                    <Value size={12} tone={fading ? 'warn' : 'dim'}>
                      {fading
                        ? `hearted ${Math.round(h.days / 30)} months ago · fading`
                        : `hearted ${h.days} ${h.days === 1 ? 'day' : 'days'} ago`}
                    </Value>
                  </View>
                  <Act label="unheart" tone="dim" ruled={false} onPress={() => onHeart(h.id)} />
                </View>
              );
            })}
          </View>
        </View>
      </View>
    </>
  );
}

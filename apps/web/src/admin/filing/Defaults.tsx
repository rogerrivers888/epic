/**
 * Defaults — ordered by how wrong they are.
 *
 * A default is assumed for every place in a drawer unless a place says
 * otherwise, which is what makes it worth having and what makes a bad one
 * expensive. This screen is the list of the ones that are not holding, so
 * somebody can retire a default rather than keep correcting what it files.
 *
 * It was called Rules until the rename (26 Sep 2026), when "rules" meant both
 * this and the Google-word mappings; those stay on Mapping.
 *
 * **Two columns, because there are two different ways to be wrong**, and Roger
 * asked for both on 20 Sep 2026. They are not the same fact and must not be
 * collapsed into one number:
 *
 *  - **Places contradict it** — computed. Of the places this default files, how
 *    many hold a different value. A high count can mean the rule is too broad,
 *    or that the drawer wants splitting. Nobody has said anything; the data
 *    disagrees with itself.
 *  - **People called it wrong** — human. How many times somebody overrode it by
 *    hand (`rule_overrides`, epic-1c). This is the stronger signal of the two,
 *    because every one of them is a person who looked at a place and said no.
 *
 * The prototype has one column here. The second is a deliberate addition:
 * "this rule has been called wrong 41 times" is, in Roger's words, the single
 * most useful number in the system, and it had nowhere to be drawn.
 */

import React from 'react';
import { View } from 'react-native';

import { Act, Band, Cell, Col, Head, Nothing, Row, Value } from './desk';
import type { RuleRow } from './types';

const RULE_COLS: Col[] = [
  { w: 280, label: 'What it sets' },
  { w: 120, label: 'Level' },
  { w: 'auto', label: 'Where' },
  { w: 90, label: 'Places', align: 'right' },
  { w: 150, label: 'Places contradict it', align: 'right',
    title: 'Computed. Of the places this default files, how many hold a different value. A high count can mean the default is too broad, or that the drawer wants splitting — nobody has said anything, the data disagrees with itself.' },
  { w: 150, label: 'People called it wrong', align: 'right',
    title: 'Human. Of those, how many were set by a person. Every one is somebody who looked at a place and said no, which makes it the stronger signal of the two and the reason it is counted separately.' },
  { w: 130, label: '' },
];

/**
 * Three corrections is where a default stops being a rounding error.
 *
 * Below it a disagreement is one odd place; at it, the rule is describing
 * something other than what it files.
 */
const ARGUED = 3;

export function Defaults({ rows, total, onRetire, onEdit }: {
  rows: RuleRow[];
  /** Every default, not just the arguable ones. */
  total: number;
  onRetire: (id: string) => void;
  onEdit: (rule: RuleRow) => void;
}) {
  const dead = rows.filter((r) => r.dead).length;

  return (
    <>
      <Band
        title={`${dead} ${dead === 1 ? 'default is' : 'defaults are'} being argued with`}
        how="defaults"
        stats={[{ label: 'Defaults', value: total }]}
      />
      <View>
        <Head cols={RULE_COLS} />
        {rows.length === 0 ? (
          <Nothing>Nothing is being argued with. Every default is holding.</Nothing>
        ) : null}
        {rows.map((r) => {
          const loud = r.contradicted >= ARGUED;
          const called = r.overridden >= ARGUED;
          return (
            <Row key={r.id} lifted={loud || called} padded={false}>
              <Cell col={RULE_COLS[0]} style={{ paddingVertical: 12 }}>
                <Value weight="600">{r.what}</Value>
              </Cell>
              <Cell col={RULE_COLS[1]} style={{ paddingVertical: 12 }}>
                <Value size={13} tone="muted">{r.level}</Value>
              </Cell>
              <Cell col={RULE_COLS[2]} style={{ paddingVertical: 12 }}>
                <Value size={13} tone="muted">{r.where}</Value>
              </Cell>
              <Cell col={RULE_COLS[3]} style={{ paddingVertical: 12 }}>
                <Value numeric>{r.places}</Value>
              </Cell>
              <Cell col={RULE_COLS[4]} style={{ paddingVertical: 12 }}>
                <Value numeric tone={loud ? 'warn' : 'muted'} weight={loud ? '800' : '400'}>
                  {r.contradicted}
                </Value>
              </Cell>
              <Cell col={RULE_COLS[5]} style={{ paddingVertical: 12 }}>
                {/*
                  A person correcting a default is worth more than a place
                  disagreeing with it, so nought here is drawn plainly rather
                  than as good news: nobody has corrected it *yet*.
                */}
                <View style={{ alignItems: 'flex-end' }}>
                  <Value numeric tone={called ? 'warn' : r.overridden ? 'ink' : 'dim'} weight={called ? '800' : '400'}>
                    {r.overridden || '—'}
                  </Value>
                  {r.overriddenAt ? <Value size={11} tone="dim">{r.overriddenAt}</Value> : null}
                </View>
              </Cell>
              <Cell col={RULE_COLS[6]} style={{ paddingVertical: 12 }}>
                <View style={{ flexDirection: 'row', alignItems: 'center', gap: 14, justifyContent: 'flex-end' }}>
                  <Act label="Retire" tone="warn" onPress={() => onRetire(r.id)} />
                  <Act label="Edit" onPress={() => onEdit(r)} />
                </View>
              </Cell>
            </Row>
          );
        })}
      </View>
      {/*
        The explanation belongs on the columns it explains, not in a caption
        under the table — "no prose on screen, no commentary captions" (the
        handoff's Interactions section, and the side-by-side audit found three
        of these). The two headers carry it on hover instead.
      */}
    </>
  );
}

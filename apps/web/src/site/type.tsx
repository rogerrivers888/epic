/**
 * Semantic text for the website. Every page has exactly one <h1> saying what the
 * page is — never "Coming soon." and never the wordmark (decision 6) — and its
 * sections are <h2>s in order. "Coming soon." keeps its size as a styled <p>.
 * React Native Web renders `role="heading"` + `aria-level` as a real <hN> and
 * `role="paragraph"` as a <p>; on native these are plain text with a header role.
 */
import React from 'react';
import { Platform, Text, type TextProps } from 'react-native';

const web = Platform.OS === 'web';
const heading = (level: number) => (web ? ({ role: 'heading', 'aria-level': level } as object) : { accessibilityRole: 'header' as const });

export function SiteH1(props: TextProps) { return <Text {...heading(1)} {...props} />; }
export function SiteH2(props: TextProps) { return <Text {...heading(2)} {...props} />; }
export function SiteH3(props: TextProps) { return <Text {...heading(3)} {...props} />; }
/** A paragraph — the right element for "Coming soon." and any line of copy. */
export function SiteP(props: TextProps) { return <Text {...(web ? ({ role: 'paragraph' } as object) : {})} {...props} />; }

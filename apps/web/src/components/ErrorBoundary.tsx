/**
 * The thing that stands between one broken component and a blank app.
 *
 * React's rule is that an error thrown while rendering — or while running a
 * cleanup on the way out of a screen — unmounts the whole tree unless something
 * above it says otherwise. Epic had nothing above it, so a single mistake on
 * one screen was a white page with no header, no tabs and no way back except
 * reloading (owner, 7 Sep 2026: "Happens regularly now when I go from one tab
 * to the other, I get a blank page").
 *
 * The boundary is not a substitute for fixing the throw. It is what decides
 * how big the damage is: one panel where a screen was, with the tabs still
 * under it, instead of nothing at all.
 *
 * `resetKey` is normally the address. Somebody who taps another tab is asking
 * for a different page, and a fresh page deserves a fresh attempt — so the
 * boundary clears itself the moment the address changes rather than making
 * them find the button.
 */

import React from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { Press } from './press';
import { BORDER, colors, radius, spacing, TARGET, type } from '../theme';
import { Icon } from './Icon';

type Props = {
  children: React.ReactNode;
  /** Change this and the boundary tries again: normally the address. */
  resetKey?: string;
  /** What to say instead of "this screen". */
  what?: string;
};

type State = { failed: boolean };

export class ErrorBoundary extends React.Component<Props, State> {
  state: State = { failed: false };

  static getDerivedStateFromError(): State {
    return { failed: true };
  }

  componentDidUpdate(prev: Props) {
    if (prev.resetKey !== this.props.resetKey && this.state.failed) this.setState({ failed: false });
  }

  componentDidCatch(error: unknown, info: unknown) {
    // The family gets a sentence; the detail goes where a developer can read it.
    // eslint-disable-next-line no-console
    console.error('Epic caught a render error', error, info);
  }

  render() {
    if (!this.state.failed) return this.props.children;
    return (
      <View style={styles.box}>
        <View style={styles.panel}>
          <Icon name="allergen" size={20} color={colors.ink} />
          <Text style={type.h3}>{this.props.what ?? 'This screen'} stopped working</Text>
          {/* True whichever boundary caught it: the inner one still has the
              tabs under it, the outer one does not, and "try again" is the way
              back from both. */}
          <Text style={[type.small, styles.body]}>Nothing has been lost. Try it again.</Text>
          <Press
            onPress={() => this.setState({ failed: false })}
            accessibilityRole="button"
            style={styles.retry}
          >
            <Icon name="refresh" size={16} color={colors.primaryFg} />
            <Text style={styles.retryText}>Try again</Text>
          </Press>
        </View>
      </View>
    );
  }
}

const styles = StyleSheet.create({
  box: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: spacing.xl, backgroundColor: colors.bg },
  panel: {
    alignItems: 'center', gap: spacing.sm, maxWidth: 420, width: '100%',
    padding: spacing.xl, borderWidth: BORDER, borderColor: colors.line, borderRadius: radius.md, backgroundColor: colors.surface,
  },
  body: { textAlign: 'center' },
  retry: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: spacing.sm,
    marginTop: spacing.md, paddingHorizontal: spacing.lg, minHeight: TARGET,
    borderRadius: radius.md, backgroundColor: colors.primary,
  },
  retryText: { color: colors.primaryFg, fontWeight: '700' },
});

/**
 * The wordmark as outlines (decision 5, owner 1 Oct 2026; Technical Foundations
 * › Responsive and accessibility). The brand Wordmark sets "Epıc" as text with a
 * dotless ı — which Google and screen readers read as "Epıc". This is the same
 * mark — Archivo 800, −0.06em, Roam's pin at 0.3em over the ı nudged 0.03em right
 * (components/Wordmark.tsx) — drawn as paths, so the page carries no "Epıc" text
 * at all: one SVG with role="img" labelled "Epic".
 *
 * The glyph outlines were taken from Archivo 800 once (opentype.js, 1000 units to
 * the em) and are fixed here; regenerate only if the brand's face changes.
 *
 * `height` means what it means on Wordmark (type at 1.05 × height), so the two
 * are interchangeable size for size. The pin is the letters' colour; only its
 * hole takes the ground (the pack: the pin is never recoloured).
 */
import React from 'react';
import { Platform, View } from 'react-native';
import Svg, { Circle, G, Path } from 'react-native-svg';
import { CREAM, INK } from '../theme';

const GLYPHS = [
  "M651 878L77 878L77 191L644 191L644 331L256 331L256 460L595 460L595 597L256 597L256 738L651 738L651 878Z",
  "M866 1064L702 1064L702 351L836 351L850 424L857 424Q884 379 925.5 359Q967 339 1018 339L1018 339Q1085 339 1133.5 369Q1182 399 1208 460Q1234 521 1234 615L1234 615Q1234 708 1208 769Q1182 830 1134 860Q1086 890 1021 890L1021 890Q989 890 961 883Q933 876 910.5 861Q888 846 872 824L872 824L866 824L866 1064ZM967 762L967 762Q1004 762 1026.5 747Q1049 732 1059 703Q1069 674 1069 632L1069 632L1069 597Q1069 555 1059 525.5Q1049 496 1026.5 481.5Q1004 467 967 467L967 467Q931 467 908.5 483.5Q886 500 875.5 530.5Q865 561 865 602L865 602L865 626Q865 656 870.5 681Q876 706 888.5 724Q901 742 920.5 752Q940 762 967 762Z",
  "M1438 878L1274 878L1274 351L1438 351L1438 878Z",
  "M1751 890L1751 890Q1664 890 1603 860Q1542 830 1509.5 768.5Q1477 707 1477 614L1477 614Q1477 521 1510 459.5Q1543 398 1604 368Q1665 338 1751 338L1751 338Q1807 338 1854.5 351Q1902 364 1937.5 391Q1973 418 1992 459Q2011 500 2011 557L2011 557L1850 557Q1850 523 1838.5 501Q1827 479 1805 468Q1783 457 1750 457L1750 457Q1712 457 1688.5 473Q1665 489 1654 520Q1643 551 1643 597L1643 597L1643 633Q1643 678 1654 709Q1665 740 1690 755.5Q1715 771 1754 771L1754 771Q1788 771 1810.5 760.5Q1833 750 1845 727.5Q1857 705 1857 671L1857 671L2011 671Q2011 726 1992 767.5Q1973 809 1938 836Q1903 863 1855 876.5Q1807 890 1751 890Z"
];

const VIEWBOX = '0 -26 2052 1114';
/** Box size per pixel of type: 2.052 wide and 1.114 tall, in ems. */
const W_PER_EM = 2.052;
const H_PER_EM = 1.1140;

export function SiteWordmark({ height = 30, ink = INK, ground = CREAM }: { height?: number; ink?: string; ground?: string }) {
  const fs = Math.round(height * 1.05);
  const label = Platform.OS === 'web' ? ({ role: 'img', 'aria-label': 'Epic' } as object) : { accessible: true, accessibilityRole: 'image' as const, accessibilityLabel: 'Epic' };
  return (
    <View {...label} style={{ width: Math.round(fs * W_PER_EM), height: Math.round(fs * H_PER_EM) }}>
      <Svg width="100%" height="100%" viewBox={VIEWBOX} {...({ 'aria-hidden': true, focusable: 'false' } as object)}>
        {GLYPHS.map((d, i) => <Path key={i} d={d} fill={ink} />)}
        <G transform="translate(1247.5 -37.5) scale(5.7692)">
          <Path d="M24 2C13 2 5 10.5 5 21c0 13 19 33 19 33s19-20 19-33C43 10.5 35 2 24 2z" fill={ink} />
          <Circle cx={24} cy={21} r={7} fill={ground} />
        </G>
      </Svg>
    </View>
  );
}

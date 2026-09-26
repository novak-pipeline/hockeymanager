/**
 * Icon system — ONE icon language for the whole app, built on Phosphor
 * (@phosphor-icons/react, MIT, pinned exact).
 *
 * Why Phosphor, and why duotone (UI polish pass, 2026-09): the GM's verdict on
 * the previous lucide set was "they look worse than emojis". lucide is a
 * single-weight 2px OUTLINE set — at 14–16px every glyph collapses to the same
 * thin grey wire, which is exactly what an emoji is not. Phosphor draws every
 * icon in six weights on one grid, so the app can speak in two registers:
 *
 *   • CONTENT icons (a news category, an award, a calendar beat) render in
 *     `duotone` — a solid outline over a 20%-tint fill of the same colour. That
 *     is the "graphic, not wireframe" read FM's own iconography has.
 *   • CHROME icons (chevrons, checks, back, close) render in `bold` — they are
 *     punctuation, and punctuation should be crisp, not decorated.
 *   • The nav rail uses `duotone` at rest and `fill` when active (NavIcon.tsx).
 *
 * Screens never import Phosphor directly: they use `Icons.X`, so the whole
 * vocabulary stays swappable from this one file.
 *
 * Usage:
 *   import { Icon } from './primitives'
 *   import { CategoryIcon, Icons } from './icons'
 *   <Icon size={16}><Icons.Trade /></Icon>
 *   <CategoryIcon category="injury" size={16} tile />
 *
 * Deep per-icon imports (`/dist/csr/X`) keep dev-server and vitest module
 * graphs small; the package's barrel pulls in ~1,500 components.
 */
import type { ComponentType } from 'react'
import type { NewsCategory } from '@domain'
import type { IconProps, IconWeight, Icon as PhIcon } from '@phosphor-icons/react/dist/lib/types'
import { LightningIcon } from '@phosphor-icons/react/dist/csr/Lightning'
import { FirstAidKitIcon } from '@phosphor-icons/react/dist/csr/FirstAidKit'
import { ArrowsLeftRightIcon } from '@phosphor-icons/react/dist/csr/ArrowsLeftRight'
import { FileTextIcon } from '@phosphor-icons/react/dist/csr/FileText'
import { TargetIcon } from '@phosphor-icons/react/dist/csr/Target'
import { MedalIcon } from '@phosphor-icons/react/dist/csr/Medal'
import { MegaphoneSimpleIcon } from '@phosphor-icons/react/dist/csr/MegaphoneSimple'
import { SnowflakeIcon } from '@phosphor-icons/react/dist/csr/Snowflake'
import { StarIcon } from '@phosphor-icons/react/dist/csr/Star'
import { TrophyIcon } from '@phosphor-icons/react/dist/csr/Trophy'
import { BinocularsIcon } from '@phosphor-icons/react/dist/csr/Binoculars'
import { MagnifyingGlassIcon } from '@phosphor-icons/react/dist/csr/MagnifyingGlass'
import { PulseIcon } from '@phosphor-icons/react/dist/csr/Pulse'
import { ShieldCheckIcon } from '@phosphor-icons/react/dist/csr/ShieldCheck'
import { ShieldIcon } from '@phosphor-icons/react/dist/csr/Shield'
import { StethoscopeIcon } from '@phosphor-icons/react/dist/csr/Stethoscope'
import { TrendUpIcon } from '@phosphor-icons/react/dist/csr/TrendUp'
import { TrendDownIcon } from '@phosphor-icons/react/dist/csr/TrendDown'
import { UsersThreeIcon } from '@phosphor-icons/react/dist/csr/UsersThree'
import { CalendarBlankIcon } from '@phosphor-icons/react/dist/csr/CalendarBlank'
import { CalendarCheckIcon } from '@phosphor-icons/react/dist/csr/CalendarCheck'
import { CurrencyDollarIcon } from '@phosphor-icons/react/dist/csr/CurrencyDollar'
import { StrategyIcon } from '@phosphor-icons/react/dist/csr/Strategy'
import { HandshakeIcon } from '@phosphor-icons/react/dist/csr/Handshake'
import { FireIcon } from '@phosphor-icons/react/dist/csr/Fire'
import { CaretUpIcon } from '@phosphor-icons/react/dist/csr/CaretUp'
import { CaretDownIcon } from '@phosphor-icons/react/dist/csr/CaretDown'
import { CaretRightIcon } from '@phosphor-icons/react/dist/csr/CaretRight'
import { CaretLeftIcon } from '@phosphor-icons/react/dist/csr/CaretLeft'
import { CircleIcon } from '@phosphor-icons/react/dist/csr/Circle'
import { DotOutlineIcon } from '@phosphor-icons/react/dist/csr/DotOutline'
import { BellIcon } from '@phosphor-icons/react/dist/csr/Bell'
import { NewspaperIcon } from '@phosphor-icons/react/dist/csr/Newspaper'
import { ChartLineUpIcon } from '@phosphor-icons/react/dist/csr/ChartLineUp'
import { SwordIcon } from '@phosphor-icons/react/dist/csr/Sword'
import { SealCheckIcon } from '@phosphor-icons/react/dist/csr/SealCheck'
import { BriefcaseIcon } from '@phosphor-icons/react/dist/csr/Briefcase'
import { AlarmIcon } from '@phosphor-icons/react/dist/csr/Alarm'
import { ScissorsIcon } from '@phosphor-icons/react/dist/csr/Scissors'
import { GraduationCapIcon } from '@phosphor-icons/react/dist/csr/GraduationCap'
import { BankIcon } from '@phosphor-icons/react/dist/csr/Bank'
import { PhoneIcon } from '@phosphor-icons/react/dist/csr/Phone'
import { ListChecksIcon } from '@phosphor-icons/react/dist/csr/ListChecks'
import { ScrollIcon } from '@phosphor-icons/react/dist/csr/Scroll'
import { ScalesIcon } from '@phosphor-icons/react/dist/csr/Scales'
import { PushPinIcon } from '@phosphor-icons/react/dist/csr/PushPin'
import { GearSixIcon } from '@phosphor-icons/react/dist/csr/GearSix'
import { SignatureIcon } from '@phosphor-icons/react/dist/csr/Signature'
import { MicrophoneIcon } from '@phosphor-icons/react/dist/csr/Microphone'
import { FlagIcon } from '@phosphor-icons/react/dist/csr/Flag'
import { PlayIcon } from '@phosphor-icons/react/dist/csr/Play'
import { PauseIcon } from '@phosphor-icons/react/dist/csr/Pause'
import { FastForwardIcon } from '@phosphor-icons/react/dist/csr/FastForward'
import { ArrowCounterClockwiseIcon } from '@phosphor-icons/react/dist/csr/ArrowCounterClockwise'
import { BarbellIcon } from '@phosphor-icons/react/dist/csr/Barbell'
import { LockIcon } from '@phosphor-icons/react/dist/csr/Lock'
import { SpeakerHighIcon } from '@phosphor-icons/react/dist/csr/SpeakerHigh'
import { SpeakerSlashIcon } from '@phosphor-icons/react/dist/csr/SpeakerSlash'
import { SparkleIcon } from '@phosphor-icons/react/dist/csr/Sparkle'
import { ArrowLeftIcon } from '@phosphor-icons/react/dist/csr/ArrowLeft'
import { ArrowRightIcon } from '@phosphor-icons/react/dist/csr/ArrowRight'
import { WarningIcon } from '@phosphor-icons/react/dist/csr/Warning'
import { GlobeHemisphereWestIcon } from '@phosphor-icons/react/dist/csr/GlobeHemisphereWest'
import { HouseIcon } from '@phosphor-icons/react/dist/csr/House'
import { BroadcastIcon } from '@phosphor-icons/react/dist/csr/Broadcast'
import { MegaphoneIcon } from '@phosphor-icons/react/dist/csr/Megaphone'
import { EnvelopeSimpleIcon } from '@phosphor-icons/react/dist/csr/EnvelopeSimple'
import { TicketIcon } from '@phosphor-icons/react/dist/csr/Ticket'
import { WrenchIcon } from '@phosphor-icons/react/dist/csr/Wrench'
import { HeartIcon } from '@phosphor-icons/react/dist/csr/Heart'
import { UserIcon } from '@phosphor-icons/react/dist/csr/User'
import { CheckCircleIcon } from '@phosphor-icons/react/dist/csr/CheckCircle'
import { CheckIcon } from '@phosphor-icons/react/dist/csr/Check'
import { XIcon } from '@phosphor-icons/react/dist/csr/X'
import { FilmReelIcon } from '@phosphor-icons/react/dist/csr/FilmReel'
import { DiceFiveIcon } from '@phosphor-icons/react/dist/csr/DiceFive'
import { HourglassMediumIcon } from '@phosphor-icons/react/dist/csr/HourglassMedium'
import { EyeIcon } from '@phosphor-icons/react/dist/csr/Eye'

/** Any icon in the vocabulary. Accepts Phosphor's props (size, weight, color…). */
export type AppIcon = ComponentType<IconProps>
export type { IconProps as AppIconProps }

/** Bind a default weight to a Phosphor glyph (a call site may still override). */
function w(I: PhIcon, weight: IconWeight): AppIcon {
  const Bound = (p: IconProps): JSX.Element => <I weight={weight} {...p} />
  Bound.displayName = `${I.displayName ?? 'Icon'}.${weight}`
  return Bound
}
const duo = (I: PhIcon): AppIcon => w(I, 'duotone')
const bold = (I: PhIcon): AppIcon => w(I, 'bold')
const fill = (I: PhIcon): AppIcon => w(I, 'fill')

/** Central icon vocabulary. Add here, reference everywhere. */
export const Icons = {
  // ── News categories & content ──
  Result: duo(LightningIcon),
  Injury: duo(FirstAidKitIcon),
  Trade: duo(ArrowsLeftRightIcon),
  Contract: duo(FileTextIcon),
  Draft: duo(TargetIcon),
  Award: duo(MedalIcon),
  /**
   * Playtest §F1: the league category was a Snowflake and the GM disliked it.
   * It is the inbox's catch-all — bulletins, memos, notices from the league
   * office — so it gets the office's own voice: a megaphone announcement.
   */
  League: duo(MegaphoneSimpleIcon),
  /** The snowflake keeps the one beat it belongs on: the Holiday Roster Freeze. */
  Freeze: duo(SnowflakeIcon),
  Milestone: duo(SealCheckIcon),
  Playoffs: duo(TrophyIcon),
  Scouting: duo(BinocularsIcon),
  Search: bold(MagnifyingGlassIcon),
  Form: duo(PulseIcon),
  Health: duo(ShieldCheckIcon),
  Shield: duo(ShieldIcon),
  Medical: duo(StethoscopeIcon),
  Up: bold(TrendUpIcon),
  Down: bold(TrendDownIcon),
  Squad: duo(UsersThreeIcon),
  Calendar: duo(CalendarBlankIcon),
  CalendarBooked: duo(CalendarCheckIcon),
  Money: duo(CurrencyDollarIcon),
  Tactics: duo(StrategyIcon),
  Deal: duo(HandshakeIcon),
  Hot: duo(FireIcon),
  Bell: duo(BellIcon),
  News: duo(NewspaperIcon),
  Chart: duo(ChartLineUpIcon),
  Rivalry: duo(SwordIcon),
  Trophy: duo(TrophyIcon),
  Star: fill(StarIcon),
  StarOutline: bold(StarIcon),
  AwardRibbon: duo(MedalIcon),
  // ── Calendar beats, banners & shell actions ──
  Briefcase: duo(BriefcaseIcon),
  Deadline: duo(AlarmIcon),
  Cut: duo(ScissorsIcon),
  DevCamp: duo(GraduationCapIcon),
  Board: duo(BankIcon),
  Phone: duo(PhoneIcon),
  Waivers: duo(ListChecksIcon),
  History: duo(ScrollIcon),
  Arbitration: duo(ScalesIcon),
  Pin: duo(PushPinIcon),
  Settings: duo(GearSixIcon),
  Signing: duo(SignatureIcon),
  Interview: duo(MicrophoneIcon),
  Flag: duo(FlagIcon),
  Training: duo(BarbellIcon),
  Lock: duo(LockIcon),
  Sparkle: duo(SparkleIcon),
  Warning: duo(WarningIcon),
  Globe: duo(GlobeHemisphereWestIcon),
  Home: duo(HouseIcon),
  Broadcast: duo(BroadcastIcon),
  Megaphone: duo(MegaphoneIcon),
  Mail: duo(EnvelopeSimpleIcon),
  Ticket: duo(TicketIcon),
  Wrench: duo(WrenchIcon),
  Heart: duo(HeartIcon),
  Person: duo(UserIcon),
  Check: duo(CheckCircleIcon),
  Replay: duo(FilmReelIcon),
  Dice: duo(DiceFiveIcon),
  Pending: duo(HourglassMediumIcon),
  Watch: duo(EyeIcon),
  Volume: duo(SpeakerHighIcon),
  VolumeOff: duo(SpeakerSlashIcon),
  // ── Media transport (filled: they are buttons you press) ──
  Play: fill(PlayIcon),
  Pause: fill(PauseIcon),
  FastForward: fill(FastForwardIcon),
  Restart: bold(ArrowCounterClockwiseIcon),
  // ── Chrome: punctuation, drawn bold ──
  ChevronUp: bold(CaretUpIcon),
  ChevronDown: bold(CaretDownIcon),
  ChevronRight: bold(CaretRightIcon),
  ChevronLeft: bold(CaretLeftIcon),
  Back: bold(ArrowLeftIcon),
  Forward: bold(ArrowRightIcon),
  Tick: bold(CheckIcon),
  Close: bold(XIcon),
  Circle: fill(CircleIcon),
  Dot: fill(DotOutlineIcon),
} as const satisfies Record<string, AppIcon>

export type IconName = keyof typeof Icons

/** News-category → icon + accent colour token. Mirrors the app's category palette. */
const CATEGORY_ICON: Record<NewsCategory, { Cmp: AppIcon; color: string }> = {
  result:    { Cmp: Icons.Result,    color: 'var(--violet-h)' },
  injury:    { Cmp: Icons.Injury,    color: 'var(--red)' },
  trade:     { Cmp: Icons.Trade,     color: 'var(--amber)' },
  contract:  { Cmp: Icons.Contract,  color: 'var(--amber)' },
  draft:     { Cmp: Icons.Draft,     color: 'var(--cyan)' },
  award:     { Cmp: Icons.Award,     color: 'var(--amber)' },
  league:    { Cmp: Icons.League,    color: 'var(--accent)' },
  milestone: { Cmp: Icons.Milestone, color: 'var(--amber)' },
  playoffs:  { Cmp: Icons.Playoffs,  color: 'var(--orange)' },
  scouting:  { Cmp: Icons.Scouting,  color: 'var(--cyan)' },
}

/** The icon component for a news category (for surfaces that lay it out themselves). */
export function categoryIcon(category: NewsCategory): AppIcon {
  return (CATEGORY_ICON[category] ?? CATEGORY_ICON.league).Cmp
}

/** Colour token for a news category (for chips/rails that don't render the icon). */
export function categoryColor(category: NewsCategory): string {
  return CATEGORY_ICON[category]?.color ?? 'var(--muted)'
}

/**
 * Renders the semantic icon for a news category at the given pixel size.
 * `tile` sets it on a rounded, category-tinted square — the FM-style badge used
 * where the icon IS the row's identity (inbox list, dashboard messages).
 */
export function CategoryIcon(props: {
  category: NewsCategory
  size?: number
  color?: string
  tile?: boolean
}): JSX.Element {
  const meta = CATEGORY_ICON[props.category] ?? CATEGORY_ICON.league
  const Cmp = meta.Cmp
  const s = props.size ?? 16
  const color = props.color ?? meta.color
  if (props.tile) {
    return (
      <span
        className="ui-icon icon-tile"
        style={{ color, width: s + 12, height: s + 12, ['--tile-c' as string]: color }}
      >
        <Cmp size={s} />
      </span>
    )
  }
  return (
    <span className="ui-icon" style={{ color }}>
      <Cmp size={s} />
    </span>
  )
}

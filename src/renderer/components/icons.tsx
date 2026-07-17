/**
 * Icon system — a curated, semantic mapping over lucide-react so screens never
 * import raw lucide names (keeps the vocabulary consistent and swappable) and
 * never fall back to emoji-as-iconography.
 *
 * Usage:
 *   import { Icon } from './primitives'
 *   import { CategoryIcon, Icons } from './icons'
 *   <Icon size={16}><Icons.Trade /></Icon>
 *   <CategoryIcon category="injury" size={16} />
 */
import type { NewsCategory } from '@domain'
import {
  Zap, Cross, ArrowLeftRight, FileText, Target, Medal, Trophy, Star, Search,
  Activity, ShieldCheck, Snowflake, TrendingUp, TrendingDown, Users, Calendar,
  DollarSign, Clipboard, Handshake, Flame, ChevronUp, ChevronDown, ChevronRight,
  Circle, Dot, Bell, Newspaper, LineChart, Stethoscope, Swords, Award,
  Briefcase, AlarmClock, Scissors, GraduationCap, Landmark, Phone, ClipboardList,
  ScrollText, Scale, Pin, Settings, PenLine, Mic, Flag, Play, Dumbbell, Lock,
  Volume2, Sparkles, ArrowLeft,
  type LucideIcon,
} from 'lucide-react'

/** Central icon vocabulary. Add here, reference everywhere. */
export const Icons = {
  Result: Zap,
  Injury: Cross,
  Trade: ArrowLeftRight,
  Contract: FileText,
  Draft: Target,
  Award: Medal,
  League: Snowflake,
  Milestone: Star,
  Playoffs: Trophy,
  Scouting: Search,
  Form: Activity,
  Health: ShieldCheck,
  Medical: Stethoscope,
  Up: TrendingUp,
  Down: TrendingDown,
  Squad: Users,
  Calendar,
  Money: DollarSign,
  Tactics: Clipboard,
  Deal: Handshake,
  Hot: Flame,
  ChevronUp,
  ChevronDown,
  ChevronRight,
  Circle,
  Dot,
  Bell,
  News: Newspaper,
  Chart: LineChart,
  Rivalry: Swords,
  Trophy,
  Star,
  AwardRibbon: Award,
  // Calendar beats, banners & shell actions
  Briefcase,
  Deadline: AlarmClock,
  Cut: Scissors,
  DevCamp: GraduationCap,
  Board: Landmark,
  Phone,
  Waivers: ClipboardList,
  History: ScrollText,
  Arbitration: Scale,
  Pin,
  Settings,
  Signing: PenLine,
  Interview: Mic,
  Flag,
  Play,
  Training: Dumbbell,
  Lock,
  Volume: Volume2,
  Sparkle: Sparkles,
  Back: ArrowLeft,
} as const

/** News-category → icon + accent colour token. Mirrors the app's category palette. */
const CATEGORY_ICON: Record<NewsCategory, { Cmp: LucideIcon; color: string }> = {
  result:    { Cmp: Zap,            color: 'var(--violet-h)' },
  injury:    { Cmp: Cross,          color: 'var(--red)' },
  trade:     { Cmp: ArrowLeftRight, color: 'var(--amber)' },
  contract:  { Cmp: FileText,       color: 'var(--amber)' },
  draft:     { Cmp: Target,         color: 'var(--cyan)' },
  award:     { Cmp: Medal,          color: 'var(--amber)' },
  league:    { Cmp: Snowflake,      color: 'var(--muted)' },
  milestone: { Cmp: Star,           color: 'var(--amber)' },
  playoffs:  { Cmp: Trophy,         color: 'var(--orange)' },
  scouting:  { Cmp: Search,         color: 'var(--cyan)' },
}

/** Colour token for a news category (for chips/rails that don't render the icon). */
export function categoryColor(category: NewsCategory): string {
  return CATEGORY_ICON[category]?.color ?? 'var(--muted)'
}

/** Renders the semantic icon for a news category at the given pixel size. */
export function CategoryIcon(props: { category: NewsCategory; size?: number; color?: string }): JSX.Element {
  const meta = CATEGORY_ICON[props.category] ?? CATEGORY_ICON.league
  const Cmp = meta.Cmp
  const s = props.size ?? 16
  return (
    <span className="ui-icon" style={{ color: props.color ?? meta.color }}>
      <Cmp width={s} height={s} strokeWidth={2} />
    </span>
  )
}

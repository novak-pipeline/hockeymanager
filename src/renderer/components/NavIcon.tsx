import type { IconKey } from './navConfig'
import type { Icon as PhIcon } from '@phosphor-icons/react/dist/lib/types'
import { HouseIcon } from '@phosphor-icons/react/dist/csr/House'
import { TrayIcon } from '@phosphor-icons/react/dist/csr/Tray'
import { ChatsCircleIcon } from '@phosphor-icons/react/dist/csr/ChatsCircle'
import { UsersThreeIcon } from '@phosphor-icons/react/dist/csr/UsersThree'
import { KanbanIcon } from '@phosphor-icons/react/dist/csr/Kanban'
import { GraphIcon } from '@phosphor-icons/react/dist/csr/Graph'
import { StrategyIcon } from '@phosphor-icons/react/dist/csr/Strategy'
import { ChartBarIcon } from '@phosphor-icons/react/dist/csr/ChartBar'
import { IdentificationBadgeIcon } from '@phosphor-icons/react/dist/csr/IdentificationBadge'
import { BarbellIcon } from '@phosphor-icons/react/dist/csr/Barbell'
import { FirstAidKitIcon } from '@phosphor-icons/react/dist/csr/FirstAidKit'
import { PlantIcon } from '@phosphor-icons/react/dist/csr/Plant'
import { CalendarBlankIcon } from '@phosphor-icons/react/dist/csr/CalendarBlank'
import { TrophyIcon } from '@phosphor-icons/react/dist/csr/Trophy'
import { GlobeHemisphereWestIcon } from '@phosphor-icons/react/dist/csr/GlobeHemisphereWest'
import { BinocularsIcon } from '@phosphor-icons/react/dist/csr/Binoculars'
import { ArrowsLeftRightIcon } from '@phosphor-icons/react/dist/csr/ArrowsLeftRight'
import { UserPlusIcon } from '@phosphor-icons/react/dist/csr/UserPlus'
import { ShieldStarIcon } from '@phosphor-icons/react/dist/csr/ShieldStar'
import { EyeIcon } from '@phosphor-icons/react/dist/csr/Eye'
import { BriefcaseIcon } from '@phosphor-icons/react/dist/csr/Briefcase'
import { CoinsIcon } from '@phosphor-icons/react/dist/csr/Coins'
import { HockeyIcon } from '@phosphor-icons/react/dist/csr/Hockey'

/**
 * Nav-rail glyphs. These were hand-drawn line art (a leaf for the Dev. Center,
 * an ellipse for a match, one "info" shield for both Club Info and GM Career);
 * they are now Phosphor, the same family as every other icon in the app.
 *
 * Duotone at rest, FILL when active — the active destination reads as a solid
 * shape, not just a tinted row, which is how FM's own rail marks "you are here".
 */
const GLYPH: Record<IconKey, PhIcon> = {
  home: HouseIcon,
  inbox: TrayIcon,
  feed: ChatsCircleIcon,
  squad: UsersThreeIcon,
  squadPlanner: KanbanIcon,
  dynamics: GraphIcon,
  tactics: StrategyIcon,
  dataHub: ChartBarIcon,
  staff: IdentificationBadgeIcon,
  training: BarbellIcon,
  medical: FirstAidKitIcon,
  devCenter: PlantIcon,
  schedule: CalendarBlankIcon,
  competitions: TrophyIcon,
  world: GlobeHemisphereWestIcon,
  scouting: BinocularsIcon,
  transfers: ArrowsLeftRightIcon,
  freeAgents: UserPlusIcon,
  clubInfo: ShieldStarIcon,
  clubVision: EyeIcon,
  gmCareer: BriefcaseIcon,
  finances: CoinsIcon,
  match: HockeyIcon,
}

export function NavIcon({ name, size = 20, active = false }: { name: IconKey; size?: number; active?: boolean }): JSX.Element {
  const G = GLYPH[name]
  return (
    <G
      size={size}
      weight={active ? 'fill' : 'duotone'}
      aria-hidden
      className="nav-glyph"
      style={{ display: 'block', flexShrink: 0 }}
    />
  )
}

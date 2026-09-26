/**
 * Per-nation name + hometown pools for generated players (youth intake,
 * fallback draft classes). Fictional by default (CLAUDE.md principle 5): the
 * pools are built from COMMON given names and common/morphological surnames of
 * each hockey nation, and every generated surname is checked against
 * FAMOUS_HOCKEY_SURNAMES so the game never mints a "new" Crosby or Ovechkin.
 * Correct diacritics throughout — a Finn is Mäkelä, not Makela.
 *
 * Birthplaces follow the source DB's format ("Hamilton, ON", "Solna, SWE") so a
 * generated kid's bio reads exactly like an imported one.
 *
 * Pure data + one deterministic generator. No Rng type import (takes a tiny
 * picker interface) so it stays usable from the data layer.
 */

export interface NamePicker {
  /** Uniform float in [0,1). */
  next(): number
}

const pick = <T>(r: NamePicker, a: readonly T[]): T => a[Math.floor(r.next() * a.length)]!

/**
 * Distinctive surnames of famous NHL players (past and present). Generated names
 * must never use them — the shipped world is fictional. Common patronymics
 * (Johansson, Andersson …) are NOT listed: they are a nation's everyday names.
 */
export const FAMOUS_HOCKEY_SURNAMES: ReadonlySet<string> = new Set([
  'Crosby', 'Ovechkin', 'Malkin', 'McDavid', 'Gretzky', 'Lemieux', 'Orr', 'Howe', 'Hull', 'Jagr', 'Jágr',
  'Kane', 'Toews', 'Stamkos', 'Hedman', 'Lundqvist', 'Zetterberg', 'Forsberg', 'Sundin', 'Selanne', 'Selänne',
  'Koivu', 'Kurri', 'Stastny', 'Šťastný', 'Hasek', 'Hašek', 'Bure', 'Fedorov', 'Datsyuk', 'Kucherov',
  'Vasilevskiy', 'Tavares', 'Bergeron', 'Marchand', 'MacKinnon', 'Matthews', 'Marner', 'Draisaitl', 'Makar',
  'Hughes', 'Tkachuk', 'Eichel', 'Panarin', 'Pastrnak', 'Pastrňák', 'Kopitar', 'Karlsson', 'Backstrom',
  'Bäckström', 'Sedin', 'Nylander', 'Rinne', 'Laine', 'Barkov', 'Aho', 'Rantanen', 'Granlund', 'Doughty',
  'Subban', 'Price', 'Brodeur', 'Lidstrom', 'Lidström', 'Chara', 'Hossa', 'Gaborik', 'Gáborík', 'Satan',
  'Šatan', 'Zubov', 'Mogilny', 'Larionov', 'Tretiak', 'Messier', 'Yzerman', 'Sakic', 'Bossy', 'Lafleur',
  'Beliveau', 'Béliveau', 'Richard', 'Plante', 'Esposito', 'Dionne', 'Trottier', 'Potvin', 'Coffey',
  'Bourque', 'Lindros', 'Kariya', 'Iginla', 'Jagr', 'Nedved', 'Nedvěd', 'Holmstrom', 'Holmström', 'Salming',
  'Naslund', 'Näslund', 'Alfredsson', 'Foppa', 'Sundstrom', 'Sundström', 'Ekholm', 'Lindholm', 'Ekman-Larsson',
  'Pettersson', 'Dahlin', 'Raymond', 'Kapanen', 'Teravainen', 'Teräväinen', 'Rask', 'Saros', 'Vatanen',
  'Tikkanen', 'Jokinen', 'Lehtinen', 'Kiprusoff', 'Timonen', 'Niittymaki', 'Heiskanen', 'Kovalchuk',
  'Kovalev', 'Samsonov', 'Bobrovsky', 'Tarasenko', 'Kaprizov', 'Shesterkin', 'Svechnikov', 'Kuznetsov',
  'Orlov', 'Gusev', 'Radulov', 'Frolov', 'Semin', 'Sergachev', 'Provorov', 'Zadorov', 'Voronkov',
  'Michalek', 'Plekanec', 'Elias', 'Eliáš', 'Hertl', 'Voracek', 'Voráček', 'Necas', 'Nečas', 'Vrana',
  'Palat', 'Palát', 'Krejci', 'Krejčí', 'Vokoun', 'Hudacek', 'Halak', 'Halák', 'Tatar', 'Tatár', 'Slafkovsky',
  'Slafkovský', 'Nemec', 'Grauer', 'Kopecky', 'Visnovsky', 'Višňovský', 'Handzus', 'Demitra', 'Stühmer',
  'Seider', 'Stutzle', 'Stützle', 'Grubauer', 'Ehrhoff', 'Sturm', 'Kahun', 'Hischier', 'Josi', 'Streit',
  'Meier', 'Niederreiter', 'Fiala', 'Hiller', 'Genoni', 'Girgensons', 'Merzlikins', 'Ozolinsh', 'Kopitar',
  'Zuccarello', 'Thoresen', 'Ehlers', 'Andersen', 'Bjugstad', 'Kessel', 'Parise', 'Suter', 'Chelios',
  'Leetch', 'Modano', 'Roenick', 'Hatcher', 'Gaudreau', 'Eichel', 'Larkin', 'Werenski', 'Fox', 'Caufield',
  'Gauthier', 'Letang', 'Giroux', 'Fleury', 'Vachon', 'Laperriere', 'Savard', 'Robitaille', 'Lecavalier',
  'St. Louis', 'Stastny', 'Hextall', 'Bedard', 'Celebrini', 'Fantilli', 'Michkov', 'Demidov', 'Schaefer',
  'Hagens', 'Frondell', 'McKenna', 'Misa', 'Gretzky', 'Nugent-Hopkins', 'Hall', 'Seguin', 'Benn', 'Pietrangelo',
  'Weber', 'Keith', 'Seabrook', 'Kopecky', 'Getzlaf', 'Perry', 'Thornton', 'Marleau', 'Heatley', 'Spezza',
  'Nash', 'Ovechkin', 'Backes', 'Oshie', 'Pavelski', 'Quick', 'Miller', 'Thomas', 'Luongo', 'Hasek',
  'Gallagher', 'Suzuki', 'Point', 'Kucherov', 'Barzal', 'Horvat', 'Scheifele', 'Wheeler', 'Ekblad',
])

export interface NationPool {
  /** Display nationality string (matches the source DB). */
  nation: string
  first: readonly string[]
  /** Authored surnames. */
  last: readonly string[]
  /** Optional morphological surname generator (stems × endings). */
  surname?: (r: NamePicker) => string
  /** Hometowns, already formatted "Town, REGION". */
  towns: readonly string[]
}

/* ───────────────────────── Canada (anglophone) ───────────────────────── */
const CAN_FIRST = [
  'Liam', 'Owen', 'Carter', 'Brody', 'Cole', 'Tyson', 'Logan', 'Evan', 'Nolan', 'Brayden', 'Connor', 'Jack',
  'Mason', 'Hunter', 'Ethan', 'Riley', 'Cameron', 'Tanner', 'Dylan', 'Kieran', 'Brett', 'Colby', 'Quinn',
  'Reid', 'Mitchell', 'Jaxon', 'Easton', 'Declan', 'Parker', 'Ryder', 'Rowan', 'Callum', 'Graham', 'Keaton',
  'Landon', 'Matthew', 'Nathan', 'Spencer', 'Tristan', 'Wyatt', 'Zachary', 'Aiden', 'Beckett', 'Caden',
  'Dawson', 'Gavin', 'Harrison', 'Isaac', 'Jonah', 'Kyle', 'Lucas', 'Micah', 'Noah', 'Oliver', 'Porter',
  'Sawyer', 'Teague', 'Wade', 'Austin', 'Blake', 'Carson', 'Drew', 'Emmett', 'Finn', 'Grady', 'Hayden',
]
const CAN_LAST = [
  'MacLeod', 'Harrington', 'Kowalchuk', 'Fraser', 'Bellamy', 'Stroud', 'Pellerin', 'Whitmore', 'Duchene-Hart',
  'McAllister', 'Brennan', 'Kerrigan', 'Lawson', 'Dunmore', 'Fairbairn', 'Gillis', 'Holloway', 'Kinsella',
  'Lockhart', 'MacIsaac', 'Mercer', 'Nesbitt', 'Ogilvie', 'Prentice', 'Rutherford', 'Sinclair', 'Thibodeau',
  'Vandermeer', 'Wiebe', 'Yakimchuk', 'Zelinski', 'Boychuk-Ross', 'Chisholm', 'Dykstra', 'Ellison', 'Friesen',
  'Galbraith', 'Hrabchak', 'Ingram', 'Janzen', 'Kowalyk', 'Lindquist', 'McCrae', 'Neufeld', 'Oakes', 'Penner',
  'Quinlan', 'Rempel', 'Stefanyk', 'Toews-Baird', 'Unruh', 'Vickers', 'Warkentin', 'Barkley', 'Cormier',
  'Dunphy', 'Ewanchuk', 'Fitzsimmons', 'Goertzen', 'Hildebrand', 'Iwasiuk', 'Kostiuk', 'Loewen', 'MacNeil',
  'Nickerson', 'Oldford', 'Pidgeon', 'Rideout', 'Sawatzky', 'Tremblett', 'Upshall-Grey', 'Van Horne',
  'Whelan', 'Ashcroft', 'Blackwood', 'Cardwell', 'Dawes', 'Evershed', 'Farnham', 'Gorman', 'Hollett',
  'Kavanagh', 'Lundy', 'Morrow', 'Norquay', 'Petrie', 'Redden-Hale', 'Stairs', 'Tobin', 'Walsh', 'Yeo',
]
const CAN_TOWNS = [
  'Oakville, ON', 'Sudbury, ON', 'Barrie, ON', 'Sarnia, ON', 'Kitchener, ON', 'Peterborough, ON', 'Kingston, ON',
  'North Bay, ON', 'Thunder Bay, ON', 'Brampton, ON', 'Mississauga, ON', 'London, ON', 'Guelph, ON', 'Oshawa, ON',
  'Windsor, ON', 'Owen Sound, ON', 'Sault Ste. Marie, ON', 'Belleville, ON', 'Whitby, ON', 'Markham, ON',
  'Kelowna, BC', 'Kamloops, BC', 'Prince George, BC', 'Victoria, BC', 'Surrey, BC', 'Langley, BC', 'Vernon, BC',
  'Red Deer, AB', 'Lethbridge, AB', 'Medicine Hat, AB', 'Calgary, AB', 'Edmonton, AB', 'St. Albert, AB',
  'Saskatoon, SK', 'Regina, SK', 'Swift Current, SK', 'Moose Jaw, SK', 'Prince Albert, SK', 'Yorkton, SK',
  'Brandon, MB', 'Winnipeg, MB', 'Steinbach, MB', 'Dauphin, MB', 'Halifax, NS', 'Sydney, NS', 'Truro, NS',
  'Moncton, NB', 'Saint John, NB', 'Fredericton, NB', 'St. John\'s, NL', 'Charlottetown, PE', 'Whitehorse, YT',
]
/* ───────────────────────── Canada (Québec) ───────────────────────── */
const QC_FIRST = [
  'Alexis', 'Antoine', 'Benoît', 'Charles', 'Christophe', 'Émile', 'Étienne', 'Félix', 'Francis', 'Gabriel',
  'Guillaume', 'Hugo', 'Jérémy', 'Justin', 'Laurent', 'Louis', 'Loïc', 'Marc-Olivier', 'Mathis', 'Maxime',
  'Nathan', 'Olivier', 'Philippe', 'Raphaël', 'Samuel', 'Simon', 'Thomas', 'Tristan', 'Vincent', 'Xavier',
  'Zachary', 'Jacob', 'William', 'Édouard', 'Anthony', 'Mathieu', 'Jean-Philippe', 'Samuel-Luc', 'Nicolas',
]
const QC_LAST = [
  'Bouchard', 'Gagnon', 'Pelletier', 'Lévesque', 'Bélanger', 'Côté', 'Ouellet', 'Gauvreau', 'Lachance',
  'Thériault', 'Boucher', 'Poulin', 'Fortin', 'Gosselin', 'Leblanc', 'Paquette', 'Dufresne', 'Charbonneau',
  'Beauchemin', 'Desrosiers', 'Lapointe', 'Morissette', 'Nadeau', 'Rivard', 'Simard', 'Tanguay', 'Vaillancourt',
  'Boisvert', 'Caron', 'Dionne-Roy', 'Gingras', 'Hébert', 'Jolicoeur', 'Labelle', 'Marcotte', 'Ménard',
  'Paradis', 'Quenneville', 'Rousseau', 'Sauvé', 'Turcotte', 'Veilleux', 'Bergevin', 'Cloutier', 'Drouin-Paré',
  'Fréchette', 'Grenier', 'Houle', 'Lafrenière-Roy', 'Mailhot', 'Pépin', 'Racine', 'Thibault', 'Brassard',
]
const QC_TOWNS = [
  'Trois-Rivières, QC', 'Sherbrooke, QC', 'Rimouski, QC', 'Chicoutimi, QC', 'Québec, QC', 'Laval, QC',
  'Gatineau, QC', 'Drummondville, QC', 'Victoriaville, QC', 'Rouyn-Noranda, QC', 'Val-d\'Or, QC', 'Blainville, QC',
  'Lévis, QC', 'Saint-Hyacinthe, QC', 'Baie-Comeau, QC', 'Shawinigan, QC', 'Terrebonne, QC', 'Repentigny, QC',
  'Montréal, QC', 'Longueuil, QC', 'Granby, QC', 'Saint-Jérôme, QC', 'Beauport, QC', 'Magog, QC',
]
/* ───────────────────────── United States ───────────────────────── */
const USA_FIRST = [
  'Jack', 'Ryan', 'Michael', 'Brady', 'Cole', 'Tyler', 'Matthew', 'Nick', 'Luke', 'Will', 'Sam', 'Joey',
  'Danny', 'Charlie', 'Henry', 'Jake', 'Caleb', 'Mason', 'Aidan', 'Bennett', 'Brock', 'Chase', 'Cooper',
  'Dominic', 'Eli', 'Garrett', 'Gunnar', 'Hudson', 'Jackson', 'Kellen', 'Logan', 'Max', 'Noah', 'Owen',
  'Paul', 'Reese', 'Sean', 'Trey', 'Tommy', 'Vincent', 'Zach', 'Andrew', 'Bobby', 'Cullen', 'Drew', 'Evan',
  'Finnegan', 'Grant', 'Hank', 'Isaiah', 'Jimmy', 'Kevin', 'Leo', 'Nolan', 'Patrick', 'Riley', 'Teddy', 'Wes',
]
const USA_LAST = [
  'O\'Donnell', 'Mulcahy', 'Brandt', 'Kowalski', 'Lindahl', 'Sorensen', 'McCaffrey', 'Pruitt', 'Dempsey',
  'Halvorsen', 'Jablonski', 'Keegan', 'Lombardi', 'Moriarty', 'Nordquist', 'Olszewski', 'Pappas', 'Quigley',
  'Rasmussen', 'Schaller', 'Thorsen', 'Vukovich', 'Wojcik', 'Brannigan', 'Callahan', 'DeLuca', 'Ferraro',
  'Gustafson', 'Hennessey', 'Iacobelli', 'Janssen', 'Kaminski', 'Lund-Harper', 'Mahoney', 'Nygaard', 'Ostrowski',
  'Pasternak-Ley', 'Rooney', 'Swenson', 'Tierney', 'Underhill', 'Vandenberg', 'Weisz', 'Ackerman', 'Buckley',
  'Costello', 'Donnelly', 'Engstrom', 'Flaherty', 'Grabowski', 'Haugen', 'Kearney', 'Leland', 'McGrath',
  'Novotny', 'Osterberg', 'Pulaski', 'Rourke', 'Sheehan', 'Toomey', 'Van Dyke', 'Whalen', 'Yurkovich', 'Zajac-Bell',
  'Brekke', 'Carrigan', 'Dvorak', 'Egan', 'Fagerstrom', 'Gilroy', 'Hanrahan', 'Kilgore', 'Lindberg', 'Malloy',
]
const USA_TOWNS = [
  'Eden Prairie, MN', 'Edina, MN', 'Duluth, MN', 'Roseau, MN', 'Minnetonka, MN', 'Bloomington, MN', 'St. Cloud, MN',
  'Grand Rapids, MN', 'Hermantown, MN', 'Warroad, MN', 'Plymouth, MI', 'Ann Arbor, MI', 'Grosse Pointe, MI',
  'Troy, MI', 'Marquette, MI', 'Boston, MA', 'Andover, MA', 'Hingham, MA', 'Belmont, MA', 'Buffalo, NY',
  'Rochester, NY', 'Syracuse, NY', 'Long Island, NY', 'Chicago, IL', 'Naperville, IL', 'Glenview, IL',
  'St. Louis, MO', 'Pittsburgh, PA', 'Philadelphia, PA', 'Madison, WI', 'Green Bay, WI', 'Fargo, ND',
  'Grand Forks, ND', 'Denver, CO', 'Colorado Springs, CO', 'Anaheim, CA', 'San Jose, CA', 'Scottsdale, AZ',
  'Dallas, TX', 'Anchorage, AK', 'Columbus, OH', 'Cleveland, OH', 'Portland, ME', 'Concord, NH', 'Burlington, VT',
  'Providence, RI', 'Hartford, CT', 'Salt Lake City, UT', 'Sioux Falls, SD', 'Raleigh, NC',
]
/* ───────────────────────── Sweden ───────────────────────── */
const SWE_FIRST = [
  'Albin', 'Alexander', 'Alfons', 'Anton', 'Arvid', 'Axel', 'Casper', 'Edvin', 'Elias', 'Emil', 'Filip',
  'Gustav', 'Hampus', 'Hugo', 'Isak', 'Jesper', 'Jonatan', 'Linus', 'Leo', 'Ludvig', 'Malte', 'Marcus',
  'Melker', 'Noel', 'Olle', 'Oscar', 'Rasmus', 'Samuel', 'Sixten', 'Theo', 'Valter', 'Viktor', 'Wilmer',
  'Vincent', 'Ebbe', 'Jonte', 'Love', 'Nils', 'Otto', 'Sigge', 'Tage', 'Vidar', 'Ville', 'Måns', 'Björn',
]
const SWE_STEMS = [
  'Berg', 'Lind', 'Sjö', 'Ek', 'Holm', 'Ahl', 'Björk', 'Dahl', 'Ny', 'Sand', 'Hed', 'Lund', 'Wall', 'Hag',
  'Gran', 'Åker', 'Öst', 'Norr', 'Sköld', 'Stål', 'Frost', 'Rosen', 'Lil', 'Ljung', 'Kvarn', 'Ask', 'Tall',
  'Alm', 'Löv', 'Häll', 'Mal', 'Sten', 'Fjäll', 'Hass', 'Stor', 'Vik', 'Söder', 'Väst', 'Kron', 'Bränn',
]
const SWE_ENDS = [
  'ström', 'qvist', 'gren', 'berg', 'lund', 'dahl', 'holm', 'man', 'stedt', 'bäck', 'sten', 'blad', 'fors',
  'vall', 'borg', 'ling', 'ander', 'én', 'mark', 'hammar', 'lin', 'näs', 'skog', 'ö',
]
const SWE_PATRO = ['Anders', 'Nils', 'Karl', 'Olof', 'Jöns', 'Per', 'Sven', 'Mats', 'Jakob', 'Mikael', 'Gustav', 'Isak', 'Jon', 'Pål']
const SWE_TOWNS = [
  'Örnsköldsvik, SWE', 'Skellefteå, SWE', 'Luleå, SWE', 'Umeå, SWE', 'Timrå, SWE', 'Sundsvall, SWE',
  'Gävle, SWE', 'Leksand, SWE', 'Mora, SWE', 'Falun, SWE', 'Västerås, SWE', 'Karlstad, SWE', 'Örebro, SWE',
  'Linköping, SWE', 'Norrköping, SWE', 'Jönköping, SWE', 'Växjö, SWE', 'Malmö, SWE', 'Göteborg, SWE',
  'Stockholm, SWE', 'Södertälje, SWE', 'Uppsala, SWE', 'Borlänge, SWE', 'Östersund, SWE', 'Kiruna, SWE',
  'Halmstad, SWE', 'Kalmar, SWE', 'Nyköping, SWE', 'Huddinge, SWE', 'Täby, SWE',
]
/* ───────────────────────── Finland ───────────────────────── */
const FIN_FIRST = [
  'Aapo', 'Aleksi', 'Arttu', 'Eetu', 'Eemeli', 'Elias', 'Joona', 'Juho', 'Jere', 'Kalle', 'Konsta', 'Lauri',
  'Leevi', 'Miro', 'Niko', 'Oliver', 'Onni', 'Otto', 'Paavo', 'Rasmus', 'Roope', 'Santeri', 'Topi', 'Tuomas',
  'Veeti', 'Valtteri', 'Vilho', 'Väinö', 'Aatu', 'Emil', 'Iivari', 'Jesse', 'Kasperi', 'Lenni', 'Matias',
  'Nooa', 'Oskari', 'Patrik', 'Samu', 'Severi', 'Toivo', 'Urho', 'Verneri', 'Eelis', 'Julius',
]
const FIN_STEMS_BACK = ['Koski', 'Lahti', 'Salo', 'Kallio', 'Harju', 'Rinta', 'Ala', 'Kangas', 'Suo', 'Pelto', 'Kauppi', 'Heino', 'Lampi', 'Ranta', 'Saari', 'Vuori', 'Laakso', 'Ojala', 'Honka', 'Karhu', 'Kuusi', 'Mustonen', 'Rauta', 'Kota', 'Paju']
const FIN_STEMS_FRONT = ['Mäki', 'Järvi', 'Kivi', 'Lehti', 'Nieme', 'Yli', 'Metsä', 'Hyvä', 'Pyy', 'Sipi', 'Mänty', 'Kytö', 'Helmi', 'Tähti', 'Kekki']
const FIN_TOWNS = [
  'Tampere, FIN', 'Turku, FIN', 'Helsinki, FIN', 'Espoo, FIN', 'Vantaa, FIN', 'Oulu, FIN', 'Jyväskylä, FIN',
  'Kuopio, FIN', 'Lahti, FIN', 'Pori, FIN', 'Rauma, FIN', 'Hämeenlinna, FIN', 'Joensuu, FIN', 'Mikkeli, FIN',
  'Lappeenranta, FIN', 'Seinäjoki, FIN', 'Vaasa, FIN', 'Kouvola, FIN', 'Kotka, FIN', 'Savonlinna, FIN',
  'Rovaniemi, FIN', 'Kajaani, FIN', 'Imatra, FIN', 'Nokia, FIN', 'Porvoo, FIN',
]
/* ───────────────────────── Russia ───────────────────────── */
const RUS_FIRST = [
  'Artyom', 'Alexei', 'Andrei', 'Anton', 'Arseni', 'Bogdan', 'Daniil', 'Denis', 'Dmitri', 'Egor', 'Fyodor',
  'Gleb', 'Ilya', 'Ivan', 'Kirill', 'Konstantin', 'Lev', 'Makar', 'Matvei', 'Maxim', 'Mikhail', 'Nikita',
  'Nikolai', 'Pavel', 'Pyotr', 'Roman', 'Ruslan', 'Semyon', 'Sergei', 'Stepan', 'Timofei', 'Timur', 'Vadim',
  'Vladislav', 'Vsevolod', 'Yaroslav', 'Yegor', 'Yuri', 'Zakhar', 'Savely', 'Miron', 'Platon', 'Rodion',
]
const RUS_LAST = [
  'Sokolovsky', 'Belousov', 'Zhuravlyov', 'Medvedkin', 'Lebedinsky', 'Gromov', 'Tikhomirov', 'Rybakov',
  'Kornilov', 'Sviridov', 'Chernyshov', 'Dorofeyev', 'Yefremov', 'Zaitsev', 'Kalinin', 'Lapshin', 'Mironov',
  'Nesterov', 'Ostrovsky', 'Pakhomov', 'Rodionov', 'Savelyev', 'Tsvetkov', 'Ushakov', 'Vinogradov', 'Yermakov',
  'Zhdanov', 'Afanasyev', 'Bystrov', 'Fomin', 'Gerasimov', 'Isayev', 'Kiselyov', 'Loginov', 'Maslov',
  'Nikiforov', 'Osipov', 'Prokofiev', 'Rozhkov', 'Seleznyov', 'Tarakanov', 'Vorobyov', 'Yakushev', 'Zverev',
  'Abramov', 'Bogomolov', 'Chistyakov', 'Denisov', 'Gorbunov', 'Kolesnikov', 'Larin', 'Mukhin', 'Polyakov',
  'Shilov', 'Titov', 'Uvarov', 'Volkonsky', 'Anikin', 'Baranov', 'Demin', 'Glebov', 'Kuzmin', 'Lukin', 'Pankov',
]
const RUS_TOWNS = [
  'Moscow, RUS', 'St. Petersburg, RUS', 'Yaroslavl, RUS', 'Chelyabinsk, RUS', 'Magnitogorsk, RUS', 'Omsk, RUS',
  'Novosibirsk, RUS', 'Kazan, RUS', 'Ufa, RUS', 'Nizhny Novgorod, RUS', 'Cherepovets, RUS', 'Tolyatti, RUS',
  'Yekaterinburg, RUS', 'Khabarovsk, RUS', 'Sochi, RUS', 'Podolsk, RUS', 'Balashikha, RUS', 'Voskresensk, RUS',
  'Novokuznetsk, RUS', 'Tyumen, RUS', 'Perm, RUS', 'Saratov, RUS', 'Penza, RUS', 'Krasnoyarsk, RUS',
  'Nizhnekamsk, RUS', 'Almetyevsk, RUS', 'Kurgan, RUS', 'Tver, RUS',
]
/* ───────────────────────── Czechia ───────────────────────── */
const CZE_FIRST = [
  'Adam', 'Aleš', 'Daniel', 'David', 'Dominik', 'Filip', 'František', 'Jakub', 'Jan', 'Jaroslav', 'Jiří',
  'Josef', 'Kryštof', 'Lukáš', 'Marek', 'Martin', 'Matěj', 'Michal', 'Ondřej', 'Patrik', 'Petr', 'Radek',
  'Roman', 'Šimon', 'Štěpán', 'Tomáš', 'Vojtěch', 'Vít', 'Zdeněk', 'Tobiáš', 'Oliver', 'Eduard', 'Matyáš',
]
const CZE_LAST = [
  'Dvořáček', 'Procházka', 'Kučera', 'Veselý', 'Horáček', 'Němeček', 'Pokorný', 'Marek', 'Pospíšil', 'Hájek',
  'Jelínek', 'Král', 'Růžička', 'Beneš', 'Fiala-Kos', 'Sedláček', 'Doležal', 'Zeman', 'Kolář', 'Navrátil',
  'Čermák', 'Vaněk', 'Urban', 'Blažek', 'Kříž', 'Kovář', 'Bartoš', 'Vlček', 'Polák', 'Musil', 'Šimek',
  'Konečný', 'Malý', 'Holub', 'Štěpánek', 'Kadlec', 'Dušek', 'Ševčík', 'Mach', 'Staněk', 'Bureš', 'Hrubý',
  'Kratochvíl', 'Tichý', 'Mareček', 'Řezníček', 'Šindelář', 'Vondráček', 'Zelenka', 'Havlík', 'Chalupa',
]
const CZE_TOWNS = [
  'Praha, CZE', 'Brno, CZE', 'Ostrava, CZE', 'Plzeň, CZE', 'Liberec, CZE', 'Olomouc, CZE', 'České Budějovice, CZE',
  'Hradec Králové, CZE', 'Pardubice, CZE', 'Zlín, CZE', 'Kladno, CZE', 'Jihlava, CZE', 'Třinec, CZE',
  'Vsetín, CZE', 'Chomutov, CZE', 'Litvínov, CZE', 'Karlovy Vary, CZE', 'Mladá Boleslav, CZE', 'Kolín, CZE',
  'Havířov, CZE', 'Přerov, CZE', 'Havlíčkův Brod, CZE', 'Písek, CZE', 'Beroun, CZE',
]
/* ───────────────────────── Slovakia ───────────────────────── */
const SVK_FIRST = [
  'Adam', 'Andrej', 'Branislav', 'Dávid', 'Dominik', 'Filip', 'Jakub', 'Ján', 'Juraj', 'Kristián', 'Ľubomír',
  'Lukáš', 'Marek', 'Martin', 'Matej', 'Michal', 'Miroslav', 'Oliver', 'Patrik', 'Peter', 'Samuel', 'Šimon',
  'Tobiáš', 'Tomáš', 'Viliam', 'Adrián', 'Maximilián', 'Róbert', 'Richard', 'Sebastián',
]
const SVK_LAST = [
  'Kováčik', 'Horváth', 'Varga', 'Tóth', 'Baláž', 'Nagy', 'Lukáč', 'Hudák', 'Kollár', 'Molnár', 'Mikuláš',
  'Oravec', 'Šimko', 'Švec', 'Polák', 'Kráľ', 'Bača', 'Hrivnák', 'Ďurica', 'Gregor', 'Jurčo', 'Kuruc', 'Ľupták',
  'Mráz', 'Novák', 'Petrík', 'Rusnák', 'Sýkora', 'Takáč', 'Urbánik', 'Vavrek', 'Zajac', 'Žilinský', 'Bednár',
  'Chovanec', 'Dudáš', 'Ferenčík', 'Halama', 'Ihnát', 'Kmeť',
]
const SVK_TOWNS = [
  'Bratislava, SVK', 'Košice, SVK', 'Žilina, SVK', 'Nitra, SVK', 'Trenčín, SVK', 'Zvolen, SVK', 'Poprad, SVK',
  'Banská Bystrica, SVK', 'Prešov, SVK', 'Martin, SVK', 'Liptovský Mikuláš, SVK', 'Michalovce, SVK',
  'Nové Zámky, SVK', 'Spišská Nová Ves, SVK', 'Skalica, SVK', 'Topoľčany, SVK',
]
/* ───────────────────────── Germany ───────────────────────── */
const GER_FIRST = [
  'Lukas', 'Leon', 'Jonas', 'Maximilian', 'Felix', 'Moritz', 'Niklas', 'Tim', 'Jannik', 'Paul', 'Julian',
  'Tobias', 'Florian', 'Simon', 'Fabian', 'Luca', 'Noah', 'Ben', 'Elias', 'Jakob', 'Korbinian', 'Leonhard',
  'Marius', 'Nico', 'Philipp', 'Quirin', 'Samuel', 'Valentin', 'Yannick', 'Justus', 'Johannes', 'Till',
]
const GER_LAST = [
  'Brandauer', 'Kessler', 'Lindemann', 'Hofbauer', 'Schäfer', 'Wagner', 'Krämer', 'Böhm', 'Hartmann', 'Maurer',
  'Schröder', 'Vogel', 'Winkler', 'Zimmermann', 'Fuchs', 'Grünwald', 'Haas', 'Jäger', 'Kuhn', 'Lorenz',
  'Möller', 'Neumayr', 'Pfeiffer', 'Rieger', 'Seidl', 'Thalmeier', 'Ulbrich', 'Weißenberger', 'Ziegler',
  'Bachmeier', 'Dietl', 'Eberle', 'Fröhlich', 'Gerstl', 'Huber', 'Kastner', 'Leitner', 'Obermaier', 'Pöschl',
  'Reindl', 'Straßer', 'Übelacker', 'Wimmer', 'Aigner', 'Brückl', 'Dengler', 'Freitag', 'Götz', 'Heilmann',
]
const GER_TOWNS = [
  'Mannheim, GER', 'Köln, GER', 'Düsseldorf, GER', 'Krefeld, GER', 'Landshut, GER', 'Rosenheim, GER',
  'Füssen, GER', 'Garmisch-Partenkirchen, GER', 'Bad Tölz, GER', 'Kaufbeuren, GER', 'Augsburg, GER',
  'Ingolstadt, GER', 'München, GER', 'Berlin, GER', 'Nürnberg, GER', 'Iserlohn, GER', 'Straubing, GER',
  'Schwenningen, GER', 'Bremerhaven, GER', 'Wolfsburg, GER', 'Weißwasser, GER', 'Regensburg, GER',
]
/* ───────────────────────── Switzerland ───────────────────────── */
const SUI_FIRST = [
  'Luca', 'Noah', 'Nico', 'Yannick', 'Janis', 'Loris', 'Gian', 'Livio', 'Andrin', 'Dario', 'Elia', 'Fabio',
  'Jonas', 'Joel', 'Lars', 'Mauro', 'Nils', 'Raphael', 'Silvan', 'Timo', 'Valentin', 'Mathieu', 'Théo',
  'Killian', 'Alessandro', 'Matteo', 'Enzo', 'Ramon', 'Sandro', 'Cédric',
]
const SUI_LAST = [
  'Bühlmann', 'Gerber', 'Hänni', 'Kälin', 'Lüthi', 'Moser', 'Rüegg', 'Schürch', 'Stucki', 'Wüthrich', 'Zbinden',
  'Ammann', 'Brunner', 'Egli', 'Frei', 'Graf', 'Hofstetter', 'Imhof', 'Kaufmann', 'Marti', 'Nussbaumer',
  'Rohrer', 'Sutter', 'Tschudi', 'Vonlanthen', 'Wyss', 'Zürcher', 'Berthoud', 'Chappuis', 'Favre', 'Monnier',
  'Rochat', 'Bernasconi', 'Cattaneo', 'Pedrazzini', 'Rossetti', 'Casanova', 'Caflisch', 'Derungs',
]
const SUI_TOWNS = [
  'Davos, SUI', 'Bern, SUI', 'Zürich, SUI', 'Lugano, SUI', 'Ambrì, SUI', 'Fribourg, SUI', 'Genève, SUI',
  'Lausanne, SUI', 'Biel/Bienne, SUI', 'Langnau, SUI', 'Kloten, SUI', 'Rapperswil, SUI', 'Zug, SUI',
  'Arosa, SUI', 'Chur, SUI', 'Olten, SUI', 'Visp, SUI', 'Sierre, SUI', 'Langenthal, SUI', 'La Chaux-de-Fonds, SUI',
]
/* ───────────────────────── Smaller nations ───────────────────────── */
const LAT_FIRST = ['Artūrs', 'Dāvis', 'Edgars', 'Emīls', 'Gustavs', 'Jānis', 'Kārlis', 'Kristaps', 'Mārtiņš', 'Miks', 'Oskars', 'Pēteris', 'Ralfs', 'Rihards', 'Roberts', 'Rūdolfs', 'Sandis', 'Toms', 'Valters', 'Eduards']
const LAT_LAST = ['Bērziņš', 'Kalniņš', 'Ozoliņš', 'Liepiņš', 'Krūmiņš', 'Pētersons', 'Vītols', 'Siliņš', 'Eglītis', 'Zariņš', 'Balodis', 'Kļaviņš', 'Lācis', 'Dzenis', 'Sproģis', 'Kalējs', 'Upenieks', 'Grīnbergs', 'Rozītis', 'Vanags']
const LAT_TOWNS = ['Rīga, LAT', 'Liepāja, LAT', 'Jelgava, LAT', 'Daugavpils, LAT', 'Ventspils, LAT', 'Valmiera, LAT', 'Ogre, LAT', 'Cēsis, LAT', 'Talsi, LAT']
const NOR_FIRST = ['Jonas', 'Mathias', 'Sander', 'Magnus', 'Tobias', 'Emil', 'Henrik', 'Sindre', 'Eirik', 'Håkon', 'Kristian', 'Mats', 'Vetle', 'Ole', 'Tor', 'Martin', 'Aksel']
const NOR_LAST = ['Haugland', 'Bakken', 'Solberg', 'Strand', 'Lie', 'Moen', 'Dahle', 'Halvorsen', 'Berntsen', 'Aasen', 'Sæther', 'Rønning', 'Kvåle', 'Løvås', 'Tveit', 'Nygård', 'Holte', 'Brække', 'Østby']
const NOR_TOWNS = ['Oslo, NOR', 'Stavanger, NOR', 'Lillehammer, NOR', 'Hamar, NOR', 'Trondheim, NOR', 'Bergen, NOR', 'Fredrikstad, NOR', 'Sarpsborg, NOR', 'Lørenskog, NOR']
const DEN_FIRST = ['Mads', 'Frederik', 'Oliver', 'Mikkel', 'Rasmus', 'Nikolaj', 'Jonas', 'Magnus', 'Emil', 'Anders', 'Kasper', 'Søren', 'Asger', 'Villads']
const DEN_LAST = ['Møller', 'Kjær', 'Lund', 'Søndergaard', 'Madsen', 'Holm-Bak', 'Kristiansen', 'Dahlgaard', 'Nørgaard', 'Bruun', 'Østergaard', 'Friis', 'Thygesen', 'Højgaard']
const DEN_TOWNS = ['Herning, DEN', 'Frederikshavn, DEN', 'Aalborg, DEN', 'Esbjerg, DEN', 'Rødovre, DEN', 'Odense, DEN', 'Herlev, DEN', 'Rungsted, DEN']
const AUT_FIRST = ['Lukas', 'David', 'Paul', 'Felix', 'Jakob', 'Tobias', 'Maximilian', 'Florian', 'Simon', 'Vinzenz', 'Leopold', 'Benjamin']
const AUT_LAST = ['Gruber', 'Hofer', 'Pichler', 'Steiner', 'Moser', 'Leitgeb', 'Egger', 'Brunner', 'Lackner', 'Wallner', 'Haider', 'Oberhauser', 'Kogler', 'Rainer']
const AUT_TOWNS = ['Wien, AUT', 'Salzburg, AUT', 'Klagenfurt, AUT', 'Villach, AUT', 'Innsbruck, AUT', 'Graz, AUT', 'Linz, AUT', 'Feldkirch, AUT']
const BLR_FIRST = ['Artyom', 'Aliaksei', 'Dzmitry', 'Ilya', 'Kirill', 'Maxim', 'Mikita', 'Pavel', 'Uladzislau', 'Yahor', 'Yauhen', 'Andrei']
const BLR_LAST = ['Kavalenka', 'Sidarenka', 'Yakimovich', 'Zhukouski', 'Hrabouski', 'Lashkevich', 'Makaranka', 'Palyakou', 'Shabunia', 'Sushko-Lin', 'Tkachenka', 'Varabei']
const BLR_TOWNS = ['Minsk, BLR', 'Hrodna, BLR', 'Homel, BLR', 'Viciebsk, BLR', 'Mahilioŭ, BLR', 'Navapolatsk, BLR']
const KAZ_FIRST = ['Arman', 'Daulet', 'Nurlan', 'Temirlan', 'Alikhan', 'Yerassyl', 'Dmitri', 'Ivan', 'Sayan', 'Adil']
const KAZ_LAST = ['Nurgaliyev', 'Bekov', 'Sarsenov', 'Omarov', 'Zhakupov-Ly', 'Kassymov', 'Tulegenov', 'Rakhimov', 'Abenov', 'Mukanov']
const KAZ_TOWNS = ['Astana, KAZ', 'Almaty, KAZ', 'Oskemen, KAZ', 'Karaganda, KAZ', 'Pavlodar, KAZ', 'Temirtau, KAZ']
const SLO_FIRST = ['Luka', 'Jan', 'Žiga', 'Anže', 'Nejc', 'Rok', 'Tilen', 'Matic', 'Blaž', 'Gašper']
const SLO_LAST = ['Horvat', 'Kranjc', 'Zupan', 'Potočnik', 'Kovačič', 'Mlakar', 'Vidmar', 'Golob', 'Rozman', 'Jerše']
const SLO_TOWNS = ['Ljubljana, SLO', 'Jesenice, SLO', 'Bled, SLO', 'Kranj, SLO', 'Celje, SLO']

const swedishSurname = (r: NamePicker): string => {
  if (r.next() < 0.35) return `${pick(r, SWE_PATRO)}sson`
  const stem = pick(r, SWE_STEMS)
  let end = pick(r, SWE_ENDS)
  // Avoid doubled stems like "Bergberg" / "Lundlund".
  if (end.toLowerCase() === stem.toLowerCase()) end = 'qvist'
  return stem + end
}

const finnishSurname = (r: NamePicker): string => {
  const front = r.next() < 0.4
  const stem = front ? pick(r, FIN_STEMS_FRONT) : pick(r, FIN_STEMS_BACK)
  if (stem.endsWith('nen')) return stem
  // Vowel harmony: front-vowel stems take -lä/-nen/-mäki, back-vowel stems -la/-nen/-maa.
  const ends = front ? ['nen', 'lä', 'nen', 'mäki', 'koski', 'järvi', 'o'] : ['nen', 'la', 'nen', 'maa', 'koski', 'aho', 'o']
  const end = pick(r, ends)
  const base = end === 'o' && /[aeiouyäö]$/.test(stem) ? stem.slice(0, -1) : stem
  const joined = base + end
  return joined.charAt(0).toUpperCase() + joined.slice(1)
}

export const NATION_POOLS: Record<string, NationPool> = {
  'Canada': { nation: 'Canada', first: CAN_FIRST, last: CAN_LAST, towns: CAN_TOWNS },
  'Canada-QC': { nation: 'Canada', first: QC_FIRST, last: QC_LAST, towns: QC_TOWNS },
  'United States': { nation: 'United States', first: USA_FIRST, last: USA_LAST, towns: USA_TOWNS },
  'Sweden': { nation: 'Sweden', first: SWE_FIRST, last: [], surname: swedishSurname, towns: SWE_TOWNS },
  'Finland': { nation: 'Finland', first: FIN_FIRST, last: [], surname: finnishSurname, towns: FIN_TOWNS },
  'Russia': { nation: 'Russia', first: RUS_FIRST, last: RUS_LAST, towns: RUS_TOWNS },
  'Czechia': { nation: 'Czechia', first: CZE_FIRST, last: CZE_LAST, towns: CZE_TOWNS },
  'Slovakia': { nation: 'Slovakia', first: SVK_FIRST, last: SVK_LAST, towns: SVK_TOWNS },
  'Germany': { nation: 'Germany', first: GER_FIRST, last: GER_LAST, towns: GER_TOWNS },
  'Switzerland': { nation: 'Switzerland', first: SUI_FIRST, last: SUI_LAST, towns: SUI_TOWNS },
  'Latvia': { nation: 'Latvia', first: LAT_FIRST, last: LAT_LAST, towns: LAT_TOWNS },
  'Norway': { nation: 'Norway', first: NOR_FIRST, last: NOR_LAST, towns: NOR_TOWNS },
  'Denmark': { nation: 'Denmark', first: DEN_FIRST, last: DEN_LAST, towns: DEN_TOWNS },
  'Austria': { nation: 'Austria', first: AUT_FIRST, last: AUT_LAST, towns: AUT_TOWNS },
  'Belarus': { nation: 'Belarus', first: BLR_FIRST, last: BLR_LAST, towns: BLR_TOWNS },
  'Kazakhstan': { nation: 'Kazakhstan', first: KAZ_FIRST, last: KAZ_LAST, towns: KAZ_TOWNS },
  'Slovenia': { nation: 'Slovenia', first: SLO_FIRST, last: SLO_LAST, towns: SLO_TOWNS },
}

/** Pool key for a nationality (falls back to anglophone Canada). */
export function poolFor(key: string): NationPool {
  return NATION_POOLS[key] ?? NATION_POOLS['Canada']!
}

/**
 * Generate a fictional name + hometown for a nation pool key. Deterministic in
 * the picker. Re-rolls (bounded) past any famous NHL surname and past any name
 * in `taken` (so one intake never mints two identical kids).
 */
export function generateNationName(
  r: NamePicker,
  poolKey: string,
  taken?: Set<string>
): { name: string; birthplace: string; nationality: string } {
  const pool = poolFor(poolKey)
  let name = ''
  for (let attempt = 0; attempt < 12; attempt++) {
    const first = pick(r, pool.first)
    const last = pool.surname && (pool.last.length === 0 || r.next() < 0.8) ? pool.surname(r) : pick(r, pool.last.length ? pool.last : ['Nordin'])
    if (FAMOUS_HOCKEY_SURNAMES.has(last)) continue
    name = `${first} ${last}`
    if (taken && taken.has(name)) continue
    break
  }
  if (!name) name = `${pick(r, pool.first)} ${pool.last[0] ?? 'Nordin'}`
  taken?.add(name)
  return { name, birthplace: pick(r, pool.towns), nationality: pool.nation }
}

const RAW_ALTER_EGOS = [
	"Frank Castle",
	"Eddie Brock",
	"Bruce Wayne",
	"Tony Stark",
	"Alec Holland",
	"Sam Wilson",
	"Hal Jordan",
	"Arthur Curry",
	"John Constantine",
	"Victor Stone",
	"Billy Batson",
	"Lucius Fox",
	"Oliver Queen",
	"Ray Palmer",
	"Charles Xavier",
	"Martin Stein",
	"Damian Wayne",
	"Diana Prince",
	"Leonard Snart",
	"Otto Octavius",
	"Scott Lang",
	"Hank Pym",
	"Barry Allen",
	"Gwen Stacy",
	"Curt Connors",
	"Booster Gold",
	"Phil Coulson",
	"Steve Rogers",
	"Caitlin Snow",
	"Edward Nygma",
	"Johnny Storm",
	"Quentin Beck",
	"Vandal Savage",
	"Reed Richards",
	"Selina Kyle",
	"Harleen Quinzel",
	"Guy Gardner",
	"Hank McCoy",
	"Lex Luthor",
	"Jane Foster",
	"John Jameson",
	"Jonathan Crane",
	"Ororo Munroe",
	"Zatanna Zatara",
	"Harvey Dent",
	"Johnny Blaze",
	"Rachel Dawes",
	"Bucky Barnes",
	"Barbara Gordon",
	"Carol Danvers",
	"Pepper Potts",
	"Slade Wilson",
	"Flint Marko",
	"Sue Storm",
	"Miles Morales",
	"John Jones",
	"Roy Harper",
	"Natasha Romanoff",
	"Peter Parker",
	"Norman Osborn",
	"Bruce Banner",
	"Cisco Ramon",
	"Kurt Wagner",
	"Jimmy Olsen",
	"Ben Grimm",
	"Flash Thompson",
	"Jean Grey",
	"Jason Todd",
	"Mary Jane",
	"Kara Danvers",
	"Felicia Hardy",
	"Wanda Maximoff",
	"Matt Murdock",
	"Stephen Strange",
	"Perry White",
	"Scott Summers",
	"Mindy Macready",
	"Clark Kent",
	"Lionel Luthor",
	"Thor Odinson",
	"Wally West",
	"Wade Wilson",
	"John Diggle",
	"Dick Grayson",
];

const ALTER_EGO_POOL = Object.freeze(
	RAW_ALTER_EGOS.slice().sort((a, b) => a.localeCompare(b)),
);

function shuffle(arr) {
	for (let i = arr.length - 1; i > 0; i--) {
		const j = Math.floor(Math.random() * (i + 1));
		[arr[i], arr[j]] = [arr[j], arr[i]];
	}
	return arr;
}

function assignAlterEgos(names) {
	const pool = ALTER_EGO_POOL.slice();
	for (let i = 1; i <= names.length - ALTER_EGO_POOL.length; i++) {
		pool.push(`Alter_Ego_${i}`);
	}
	shuffle(pool);
	return names.map((name, i) => ({ name, alterEgo: pool[i] }));
}

module.exports = { ALTER_EGO_POOL, assignAlterEgos };

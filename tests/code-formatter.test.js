const { test } = require("node:test");
const assert = require("node:assert/strict");
const { formatCodeForAutoTyping } = require("../src/renderer/code-formatter");

const cases = [
	{
		name: "Example A",
		code: `<!DOCTYPE html>
<html>
   <head>
      <title>Emordnilap JS</title>
   </head>
   <body>
      <canvas id="myCanvas" width="600" height="600"></canvas>
      <script>
         const { width, height } = myCanvas;
         const ctx = myCanvas.getContext("2d");
      </script>
   </body>
</html>`,
		expected: `<!DOCTYPE html>
<html>
↢</html>↑►
<head>
</head>↑►
<title>Emordnilap JS</title>↓►
<body>
</body>↑►
<canvas id="myCanvas" width="600" height="600"></canvas>
<script>
↢</script>↑►
const { width, height } = myCanvas;
const ctx = myCanvas.getContext("2d");`,
	},
	{
		name: "Example B",
		code: `class Bar {
   constructor(text, x, y, height = 40) {
      this.text = text;
      this.x = x;
      this.y = y;
      this.height = height;
   }

   draw(ctx) {
      ctx.fillText(this.text, this.x, this.y);
   }
}`,
		expected: `class Bar {
}↑►
constructor(text, x, y, height = 40) {
}↑►
this.text = text;
this.x = x;
this.y = y;
this.height = height;↓►

draw(ctx) {
}↑►
ctx.fillText(this.text, this.x, this.y);`,
	},
	{
		name: "Example C",
		code: `const [location, setLocation] = useState<L.LocationObject | null>(null);

useEffect(() => {
   let subscription: L.LocationSubscription;

   (async () => {
      const { status } = await L.requestForegroundPermissionsAsync();
      if (status !== "granted") {
         return;
      }

      subscription = await L.watchPositionAsync(
         {
            accuracy: L.Accuracy.High,
            timeInterval: 1000,
            distanceInterval: 1
         }
         , (newLocation) => {
            setLocation(newLocation);
         }
      );
   })();
}, []);`,
		expected: `const [location, setLocation] = useState<L.LocationObject | null>(null);

useEffect(() => {
}, []);↑►
let subscription: L.LocationSubscription;

(async () => {
})();↑►
const { status } = await L.requestForegroundPermissionsAsync();
if (status !== "granted") {
}↑►
return;↓►

subscription = await L.watchPositionAsync(
);↑►
{
}↑►
accuracy: L.Accuracy.High,
timeInterval: 1000,
distanceInterval: 1↓►
, (newLocation) => {
}↑►
setLocation(newLocation);`,
	},
	{
		name: "Example D",
		code: `<!DOCTYPE html>
<html>
    <head>
        <title>Chess 123456</title>
        <style>
            .cell  {
                border: 2px solid black;
                display: flex;
                align-items: center;
                justify-content: center;
            }

            .light { background-color: white; }
            .dark  { background-color: gray;  }

            #chess-board {
                width: 400px;
                height: 400px;
                display: grid;
                grid-template-rows: repeat(8, 1fr); /* 1 fraction */
                grid-template-columns: repeat(8, 1fr);
            }

            img {
                width: 50%;
            }

            .invert-color {
                filter: invert(100%);
            }
        </style>
    </head>`,
		expected: `<!DOCTYPE html>
<html>
↢</html>↑►
<head>
</head>↑►
<title>Chess 123456</title>
<style>
</style>↑►
.cell {
}↑►
border: 2px solid black;
display: flex;
align-items: center;
justify-content: center;↓►

.light { background-color: white; }
.dark { background-color: gray; }

#chess-board {
}↑►
width: 400px;
height: 400px;
display: grid;
grid-template-rows: repeat(8, 1fr); /* 1 fraction */
grid-template-columns: repeat(8, 1fr);↓►

img {
}↑►
width: 50%;↓►

.invert-color {
}↑►
filter: invert(100%);`,
	},
];

for (const { name, code, expected } of cases) {
	test(`formatCodeForAutoTyping — ${name}`, () => {
		const actual = formatCodeForAutoTyping(code);
		assert.equal(actual, expected);
	});
}

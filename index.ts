import * as program from 'commander';
import * as tmp from 'tmp';
import * as shellescape from 'shell-escape';
import * as path from 'path';
import { execSync, exec } from 'child_process';
import { createCanvas, loadImage } from 'canvas';
import * as cliProgress from 'cli-progress';
import * as flatten from 'array-flatten';
import * as Offset from 'polygon-offset';

const globalAny:any = global;
globalAny.requestAnimationFrame = (callback) => {
  return (setTimeout(callback, 0));
}

import { Scene, Sprite, Label } from 'spritejs';

import * as pix from 'pixfinder';
import * as fs from 'fs';

program
  .version('0.0.1', '-v, --version')
  .option('-i, --input [path]', 'Input image')
  .option('-o, --output [path]', 'Output directory')
  .option('-c, --colors [integer]', 'Number of colors')
  .option('-w, --width [integer]', 'Width of the output video')
  .option('-h, --height [integer]', 'Height of the output video')
  .option('-s, --speed [integer]', 'Number of ms between points (higher means slower movement)')
  .option('-f, --fuzziness [integer]', 'Deviation from horizontal drawing (higher means fuzzier)')
  .option('-t, --trim [percentage]', 'Percentage of points to trim')
  .option('-m, --music [path]', 'Path to soundtrack')
  .option('-b, --background [color]', 'Background color')
  .option('-p, --padding [pixel]', 'Number of pixel between color and area edges')
  .parse(process.argv)

const INPUT_PATH = program.input;
const WIDTH = program.width || 640;
const HEIGHT = program.height || 480;
const FUZZINESS = program.fuziness || 3;
const SPEED = program.speed || 1000;
const COLORS = program.colors || 8;
const OUTPUT_DIR = program.output || "/tmp/";
const MUSIC_PATH = program.music || path.resolve( __dirname, "./assets/music.flac");
const BACKGROUND_COLOR = program.background || 'white';
const TRIM = program.trim || 33;
const ENABLE_PROGRESS = false;
const PADDING = program.padding || 2;

const HAND_PATH = path.resolve( __dirname, "./assets/hand.png");
const HAND_TIP_X = 0;
const HAND_TIP_Y = 1017;

function sortPoints(points) {
  // points = points.filter(() => (Math.random() * 100) > parseInt(TRIM))

  for (let i = points.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [points[i], points[j]] = [points[j], points[i]];
  }
  return points
    .sort((p1, p2) => p1.y - p2.y - (Math.random() * parseInt(FUZZINESS)) + parseFloat(FUZZINESS) / 2.0)
}

// function getArea(points) {
//   let area = 0, i, j;
//
//   for (i = 0, j = points.length - 1; i < points.length; j = i, i++) {
//       area += points[i].x * points[j].y;
//       area -= points[i].y * points[j].x;
//   }
//   area /= 2;
//   return area;
// }
//
// function getCentroid(points) {
//   let x = 0, y = 0, i, j, f;
//
//   for (i = 0, j = points.length - 1; i < points.length; j = i, i++) {
//       f = points[i].x * points[j].y - points[j].x * points[i].y;
//       x += (points[i].x + points[j].x) * f;
//       y += (points[i].y + points[j].y) * f;
//   }
//
//   f = this.area() * 6;
//
//   return [ x / f, y / f ];
// }

tmp.dir(async (err, tmpdir) => {
  tmpdir = "/tmp";

  const RESIZED_PATH = path.join(tmpdir, "resized.png");
  const PAINTED_PATH = path.join(tmpdir, "painted.png");
  const SKETCH_PATH = path.join(tmpdir, "sketch.png");

  console.log("Resize image");
  execSync(shellescape(["convert", INPUT_PATH, "-resize", `${WIDTH}x${HEIGHT}`, "-crop", `${WIDTH}x${HEIGHT}+0+0`, "+repage", "-gravity", "center", RESIZED_PATH ]), { cwd: tmpdir });

  console.log("Get image dimensions");
  const resized_image = await loadImage(RESIZED_PATH);
  const IMAGE_WIDTH = resized_image.width;
  const IMAGE_HEIGHT = resized_image.height;
  const IMAGE_X = (WIDTH - IMAGE_WIDTH) / 2;
  const IMAGE_Y = (HEIGHT - IMAGE_HEIGHT) / 2;

  console.log("Generate painted version");
  execSync(shellescape(["convert", RESIZED_PATH, "-colors", COLORS, "-paint", "5", PAINTED_PATH ]), { cwd: tmpdir });

  console.log("Extract colors");
  const colors = execSync(shellescape(["convert", PAINTED_PATH, "-unique-colors", "txt:"]), { cwd: tmpdir }).toString().match(/#[0-9a-f]{6}/gi)//.slice(0, 1);

  console.log("Generate sketch version");
  // execSync(shellescape(["convert", RESIZED_PATH, "-colorspace", "gray", "-sketch", "0x20+120", "-fuzz", "20%", "-transparent", BACKGROUND_COLOR, SKETCH_PATH ]), { cwd: tmpdir });
  execSync(shellescape(["convert", RESIZED_PATH, "-colorspace", "gray", "-negate", "-edge", "1", "-negate", "-transparent", BACKGROUND_COLOR, SKETCH_PATH ]), { cwd: tmpdir });

  const sketch_image = await loadImage(SKETCH_PATH);

  const drawing_canvas = createCanvas(WIDTH, HEIGHT);
  const drawing_canvas_ctx = drawing_canvas.getContext('2d');

  drawing_canvas_ctx.fillStyle = BACKGROUND_COLOR;
  drawing_canvas_ctx.fillRect(0, 0, WIDTH, HEIGHT);

  let frame = 0;

  const scene = new Scene('main', { viewport: [ WIDTH, HEIGHT ], resolution: [ WIDTH, HEIGHT ]})
  const backgroundLayer = scene.layer('background');
  backgroundLayer.timeline.playbackRate = 0;

  const handLayer = scene.layer('handLayer');

  let progress;
  // if (ENABLE_PROGRESS) {
  //   progress = new cliProgress.Bar({}, cliProgress.Presets.shades_classic);
  //   progress.start(flatten(Object.values(areasByColor)).length, 0);
  // }
  let pointCounter = 0;

  for (let colorIndex = 0; colorIndex < colors.length; colorIndex++) {
    const color = colors[colorIndex];
    const hand = new Sprite({ textures: HAND_PATH, zIndex: 1 });
    handLayer.append(hand);

    await loadImage(HAND_PATH);

    const COLORED_PATH = path.join(tmpdir, `${color}.png`);
    execSync(shellescape(["convert", PAINTED_PATH, "-matte", "(", "+clone", "-transparent", color, ")", "-compose", "DstOut", "-composite", COLORED_PATH ]), { cwd: tmpdir });

    const colored_image = await loadImage(COLORED_PATH);

    const colored_image_canvas = createCanvas(IMAGE_WIDTH, IMAGE_HEIGHT);
    const colored_image_canvas_ctx = colored_image_canvas.getContext('2d');
    colored_image_canvas_ctx.drawImage(colored_image, 0, 0);

    const areas = pix.findAll({
      img: colored_image_canvas,
      tolerance: 1,
      distance: 1,
      accuracy: 1,
      colors: [color.replace('#', '')],
      clearNoise: false
    });

    // const sprite = new Sprite();
    // sprite.attr({ textures: COLORED_PATH, width: IMAGE_WIDTH, height: IMAGE_HEIGHT, x: IMAGE_X, y: IMAGE_Y });
    // backgroundLayer.append(sprite);

    // await loadImage(COLORED_PATH);

    // create mask
    const mask_canvas = createCanvas(WIDTH, HEIGHT);
    const mask_canvas_ctx = mask_canvas.getContext('2d');
    mask_canvas_ctx.fillStyle = BACKGROUND_COLOR;
    mask_canvas_ctx.fillRect(0, 0, WIDTH, HEIGHT);
    mask_canvas_ctx.drawImage(drawing_canvas, IMAGE_X, IMAGE_Y);

    mask_canvas_ctx.globalCompositeOperation = 'destination-out';

    let previousPoint = { x: IMAGE_X, y: IMAGE_Y };
    for (let areaIndex = 0; areaIndex < areas.length; areaIndex++) {
      const points = sortPoints([ ...areas[areaIndex] ]);
      // const points = areas[areaIndex];
      let drawnArea = [];

      mask_canvas_ctx.beginPath();

      var offset = new Offset();
      // const marginedPoints = flatten.depth(offset.data(areas[areaIndex].map((point) => [point.x, point.y])).padding(parseInt(PADDING)), 1);
      const marginedPoints = areas[areaIndex].map((point) => [point.x, point.y]);

      // console.log(marginedPoints);
      mask_canvas_ctx.moveTo(marginedPoints[0][0] + IMAGE_X, marginedPoints[0][1] + IMAGE_Y);
      marginedPoints.forEach((point) => {
        // console.log(point);
        mask_canvas_ctx.lineTo(point[0] + IMAGE_X, point[1] + IMAGE_Y);
      });
      mask_canvas_ctx.closePath();
      mask_canvas_ctx.fillStyle = 'red';

      mask_canvas_ctx.fill();

      for (let pointIndex = 0; pointIndex < points.length; pointIndex++) {

        const currentPoint = {
          x: points[pointIndex].x + IMAGE_X - HAND_TIP_X,
          y: points[pointIndex].y + IMAGE_Y - HAND_TIP_Y
        };
        const distance = Math.sqrt(Math.pow(previousPoint.x - currentPoint.x, 2) + Math.pow(previousPoint.y - currentPoint.y, 2)) / IMAGE_WIDTH;
        if (distance > 0.05) {
          hand.on('afterdraw', async (event) => {
            // Draw lines
            drawing_canvas_ctx.beginPath();
            drawing_canvas_ctx.strokeStyle = color;
            drawing_canvas_ctx.lineWidth = 2;

            const currentPoint = drawnArea[drawnArea.length - 1];
            if (currentPoint) {
              drawing_canvas_ctx.moveTo(currentPoint.x + HAND_TIP_X, currentPoint.y + HAND_TIP_Y);
              drawing_canvas_ctx.lineTo(event.target.getAttribute('pos')[0] + HAND_TIP_X, event.target.getAttribute('pos')[1] + HAND_TIP_Y);
            }
            drawing_canvas_ctx.stroke();

            const output_canvas = createCanvas(WIDTH, HEIGHT);
            const output_canvas_ctx = output_canvas.getContext('2d');
            output_canvas_ctx.drawImage(drawing_canvas, 0, 0);
            output_canvas_ctx.drawImage(mask_canvas, 0, 0);
            // output_canvas_ctx.drawImage(sketch_image, IMAGE_X, IMAGE_Y);
            output_canvas_ctx.drawImage(await scene.snapshot(), 0, 0);

            // Write PNG file
            fs.writeFileSync(path.join(OUTPUT_DIR, `out-${frame}.png`), output_canvas.toBuffer());
            frame += 1;
          });

          await hand.animate([ currentPoint ],
          {
            duration: distance * parseInt(SPEED),
            fill: 'forwards'
          }).finished;

          hand.off('afterdraw');
          previousPoint = currentPoint;
        }

        if (progress) {
          progress.update(pointCounter++);
        }

        drawnArea.push(currentPoint);
      }
    }
    handLayer.remove(hand);
  }
  execSync(shellescape(["ffmpeg", "-i", path.join(OUTPUT_DIR, 'out-%d.png'), "-i", MUSIC_PATH, "-y", "-c:a", "libfdk_aac", "-c:v", "libx264", "-vf", "fps=25", path.join(OUTPUT_DIR, 'out.mp4') ]), { cwd: tmpdir });
});

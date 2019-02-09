import * as program from 'commander';
import * as tmp from 'tmp';
import * as shellescape from 'shell-escape';
import * as path from 'path';
import { execSync, exec } from 'child_process';
import { createCanvas, loadImage } from 'canvas';
import * as cliProgress from 'cli-progress';
import * as flatten from 'array-flatten';

const globalAny:any = global;
globalAny.requestAnimationFrame = (callback) => {
  return (setTimeout(callback, 0));
}

import { Scene, Sprite, Label } from 'spritejs';

import * as pix from 'pixfinder';
import * as fs from 'fs';

const WIDTH = 1920;
const HEIGHT = 1080;
const HAND_PATH = "./assets/hand.png";
const HAND_TIP_X = 0;
const HAND_TIP_Y = 1017;

program
  .version('0.0.1', '-v, --version')
  .option('-i, --input [path]', 'Input image')
  .option('-o, --output [path]', 'Output directory')
  .option('-c, --colors [value]', 'Number of colors')
  .option('-s, --speed [value]', 'Number of ms between points')
  .parse(process.argv)

tmp.dir(async (err, tmpdir) => {
  tmpdir = "/tmp";

  const RESIZED_PATH = path.join(tmpdir, "resized.png");
  const PAINTED_PATH = path.join(tmpdir, "painted.png");
  const SKETCH_PATH = path.join(tmpdir, "sketch.png");

  console.log("Resize image");
  execSync(shellescape(["convert", program.input, "-resize", `${WIDTH}x${HEIGHT}`, "-crop", `${WIDTH}x${HEIGHT}+0+0`, "+repage", "-gravity", "center", RESIZED_PATH ]), { cwd: tmpdir });

  console.log("Get image dimensions");
  const resized_image = await loadImage(RESIZED_PATH);
  const IMAGE_WIDTH = resized_image.width;
  const IMAGE_HEIGHT = resized_image.height;
  const IMAGE_X = (WIDTH - IMAGE_WIDTH) / 2;
  const IMAGE_Y = (HEIGHT - IMAGE_HEIGHT) / 2;

  console.log("Generate painted version");
  execSync(shellescape(["convert", RESIZED_PATH, "-colors", program.colors, "-paint", "5", PAINTED_PATH ]), { cwd: tmpdir });

  console.log("Extract colors");
  const colors = execSync(shellescape(["convert", PAINTED_PATH, "-unique-colors", "txt:"]), { cwd: tmpdir }).toString().match(/#[0-9a-f]{6}/gi)//.slice(0, 1);

  console.log("Extract areas")
  const painted_image = await loadImage(PAINTED_PATH);
  const painted_image_canvas = createCanvas(IMAGE_WIDTH, IMAGE_HEIGHT);
  const painted_image_ctx = painted_image_canvas.getContext('2d');
  painted_image_ctx.drawImage(painted_image, 0, 0);

  const areasByColor = colors.map((color) => (
    pix.findAll({
      img: painted_image_canvas,
      tolerance: 50,
      distance: 10,
      accuracy: 1,
      colors: [color.replace('#', '')],
      clearNoise: true
    })
  ))

  console.log("Generate sketch version");
  // execSync(shellescape(["convert", RESIZED_PATH, "-colorspace", "gray", "-sketch", "0x20+120", "-fuzz", "20%", "-transparent", "white", SKETCH_PATH ]), { cwd: tmpdir });
  execSync(shellescape(["convert", RESIZED_PATH, "-colorspace", "gray", "-negate", "-edge", "1", "-negate", "-transparent", "white", SKETCH_PATH ]), { cwd: tmpdir });

  let frame = 0;

  const scene = new Scene('main', { viewport: [ WIDTH, HEIGHT ], resolution: [ WIDTH, HEIGHT ]})
  const backgroundLayer = scene.layer('background');
  backgroundLayer.timeline.playbackRate = 0;

  const handLayer = scene.layer('handLayer');
  const progress = new cliProgress.Bar({}, cliProgress.Presets.shades_classic);
  progress.start(flatten(areasByColor).length, 0);
  let pointCounter = 0;

  for (let colorIndex = 0; colorIndex < colors.length; colorIndex++) {
    const color = colors[colorIndex];
    const areas = areasByColor[colorIndex];

    const hand = new Sprite();
    hand.attr({ textures: HAND_PATH, zIndex: 1 });
    handLayer.append(hand);

    await loadImage(HAND_PATH);

    const COLORED_PATH = path.join(tmpdir, `${color}.png`);
    execSync(shellescape(["convert", PAINTED_PATH, "-matte", "(", "+clone", "-transparent", color, ")", "-compose", "DstOut", "-composite", COLORED_PATH ]), { cwd: tmpdir });

    await scene.preload(COLORED_PATH);

    const sprite = new Sprite();
    sprite.attr({ textures: COLORED_PATH, width: IMAGE_WIDTH, height: IMAGE_HEIGHT, x: IMAGE_X, y: IMAGE_Y });
    // backgroundLayer.append(sprite);

    await loadImage(COLORED_PATH);

    let previousPoint = { x: IMAGE_X, y: IMAGE_Y };
    let drawnAreas = [];
    for (let areaIndex = 0; areaIndex < areas.length; areaIndex++) {
      const points = areas[areaIndex];
      drawnAreas[areaIndex] = [];

      for (let pointIndex = 0; pointIndex < points.length; pointIndex++) {

        const currentPoint = {
          x: points[pointIndex].x + IMAGE_X - HAND_TIP_X,
          y: points[pointIndex].y + IMAGE_Y - HAND_TIP_Y
        };
        const distance = Math.sqrt(Math.pow(previousPoint.x - currentPoint.x, 2) + Math.pow(previousPoint.y - currentPoint.y, 2)) / IMAGE_WIDTH;
        if (distance > 0.05) {
          hand.on('afterdraw', async () => {
            const canvas = await scene.snapshot()
            const ctx = canvas.getContext("2d");
            ctx.strokeStyle = color;
            ctx.lineWidth = 5;

            // Draw lines
            drawnAreas.forEach((drawnArea) => {
              ctx.beginPath();
              drawnArea.forEach((point, index) => {
                if (index === 0) {
                  ctx.moveTo(point.x + HAND_TIP_X, point.y + HAND_TIP_Y);
                } else {
                  ctx.lineTo(point.x + HAND_TIP_X, point.y + HAND_TIP_Y);
                }
              });
              ctx.stroke();
            });

            // Write PNG file
            fs.writeFileSync(path.join(program.output, `out-${frame}.png`), canvas.toBuffer())
            frame += 1;
          });

          await hand.animate([ currentPoint ],
          {
            duration: distance * parseInt(program.speed),
            fill: 'forwards'
          }).finished;

          hand.off('afterdraw');
          previousPoint = currentPoint;
        }

        progress.update(pointCounter++);
        drawnAreas[areaIndex].push(currentPoint);
      }
    }
  }
  execSync(shellescape(["ffmpeg", "-i", path.join(program.output, 'out-%d.png'), "-y", "-c:v", "libx264", "-vf", "fps=25", path.join(program.output, 'out.mp4') ]), { cwd: tmpdir });
});

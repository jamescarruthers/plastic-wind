# Plastic Wind

A web app that designs reed and membrane wind instruments for 3D printing and
exports them as 3MF. It runs entirely in the browser.

Pick an instrument (or set your own range), choose a mouthpiece, a pipe size
for the inlet and a body layout. The app works out where the tone holes go,
builds the solid parts and lays them out on print beds.

## What it does

**Instruments.** Chalumeau, keyless clarinet, keyless saxophone, oboe family,
shawm, dulcian/curtal (bassoon), crumhorn, rackett, bagpipe chanter and duduk,
each in treble-to-bass sizes. Or choose *Custom* and set the lowest note,
scale and number of notes, or type a list of notes. A4 and the air temperature
are adjustable.

**Bore.** Cylindrical (clarinet-like) or a conical taper (oboe-like), with an
optional flared bell. A cylindrical bore can match the inside of the inlet pipe
so the joint is smooth.

**Mouthpiece.**
- *Single reed*: a printed mouthpiece for B♭/E♭ clarinet, alto or tenor sax
  reeds (flat table, facing curve, window, ligature grooves), or an adapter for
  a shop-bought mouthpiece.
- *Double reed*: a seat for a drinking-straw reed, an oboe reed staple, or a
  bassoon reed on a printed bocal tip. Optional crumhorn-style wind cap.
- *Latex membrane*: a chamber with a rim to stretch a piece of glove over, a
  clamp ring, a side blow tube, and either a printed nozzle or the inlet pipe
  itself as an adjustable nozzle.

**Inlet.** Sockets (or spigots) sized for UK/EU and US copper pipe, 21.5 mm
overflow pipe, waste pipe, conduit and PVC, or a custom size. The pipe can be
left out (the mouthpiece plugs into the body), cut to a length you choose, or
given a calculated length so that cheap pipe replaces the hole-free part of
the bore.

**Air path.**
- *Straight*.
- *Folded with U-bends*: loops to one side between finger holes keep the holes
  at the spacing you set, however far apart the acoustics want them; legs on
  the other side fold the hole-free upper bore (as on a dulcian or rackett);
  the bell can turn back up, saxophone style.
- *Alternating loops*: loops go left and right in turn, starting on the side
  you choose, so the instrument
  balances about the finger holes. Folded legs then cross over above the top
  hole and run down beyond the loops.
- *Joining pipe*: the hole-free upper bore prints as its own block, joined to
  the finger block by a length of the inlet pipe size. The pipe is part of
  the bore in the acoustic model, and saves printing.
- *Loops behind*: the same folds go behind the finger holes instead of to the
  side, so the body is narrow from the front and fingers can wrap round to
  the holes. Finger holes are drilled out of the front edge, the thumb hole
  moves to the side, and the folded legs sit behind the loops. The bore still
  lies in one plane, so the halves print the same way.

**Body shape.** A tube that follows the bore, a tube with webs filling the
bends, a flat slab that follows the bore, or flat blocks: one rectangle per
loop, leg group and the finger line, with square or rounded corners and the
inlet socket sunk into the body.

**Printing.**
- One piece, or two halves split along the bore and glued. The split plane
  runs through the whole bore, so each half prints cut-face down with no
  supports.
- Dowel holes for alignment (1.75 mm filament works as dowels).
- A pointed bore roof option that prints without sagging while keeping the
  same cross-section area.
- Cutting to fit the bed. Front and back halves are cut at staggered places so
  the joints overlap like brickwork. One-piece straight bodies get spigot and
  socket joints.
- Fit-test rings to check the pipe and mouthpiece fit before the long print.
- Holes can print undersize for drilling out to the exact size.

**Output.** A 3MF with every part as a separate object, packed onto
bed-sized plates, plus build notes (hole table, pipe cut length, dowel count,
assembly and tuning steps) inside the file and as a text download. Designs can
be saved as JSON or shared as a link.

## How the holes are placed

The bore is modelled as a chain of acoustic transfer matrices: cylinders
(cones are sliced into short cylinders) with visco-thermal wall losses, tone
holes as shunt and series impedances using the Lefebvre & Scavone (2012)
length corrections, and an unflanged radiating end. The reed end is closed,
so each note's pitch is a peak in the input impedance.

The solver sets the bore length for the lowest note, then moves each hole in
turn, bottom first, until its fingering sounds the target note, and repeats
until every note is within half a cent. A hole crowded against the one below
is made smaller so it can move up. The *Notes* tab shows the predicted pitch
of every fingering and the overblown note (an octave up on a cone, a twelfth
on a cylinder).

The model is a starting point. Reed set-up, print accuracy and the player
all move the pitch. Print the fit tests, then a first instrument, and use
*Mouthpiece correction* (advanced settings) if every note is off by the same
amount.

## Limits

- Fingerings are simple: each note opens one more hole from the bottom. Cross
  fingerings are not modelled.
- There are no keys, so wide-bore bass instruments need large finger
  stretches or small holes. The app warns when a stretch is long.
- Bends are treated as straight tube acoustically.
- Large bores cannot bend tightly, so loops cannot bring their holes as close
  as a narrow bore allows.

## Development

```bash
npm install
```

```bash
npm run dev
```

```bash
npm test
```

```bash
npm run build
```

The solver and geometry run in a Web Worker. Solid modelling uses
[manifold-3d](https://github.com/elalish/manifold) (WebAssembly), the preview
uses three.js, and the 3MF is zipped with fflate.

| Path | Contents |
| --- | --- |
| `src/acoustics/` | Transfer-matrix model and hole solver |
| `src/model/` | Design parameters, presets, pipe sizes, notes |
| `src/geometry/` | Path layout, body and mouthpiece solids |
| `src/export/` | 3MF writer |
| `src/ui/` | Parameter panel and 3D viewer |
| `tests/` | Solver accuracy, every preset, 3MF validity, open air path (bell, every hole, no breaks in the wall) |

## Deployment

`.github/workflows/pages.yml` builds, tests and deploys to GitHub Pages on
every push to `main`. In the repository settings, set *Pages → Source* to
*GitHub Actions*. The build uses relative paths, so it works under any
sub-path.

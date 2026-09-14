-- The craft inventory, all of it.
--
-- Owner, 14 September 2026: "It's just a list of skills. There's nothing to
-- protect here, and I asked for us to be able to just extract that list and
-- utilise it… We don't need to send an email." And, on the grading the source
-- carries: "we don't need to have this attribute around endangered or not.
-- We're not interested in that."
--
-- Migration 102 seeded the crafts a launch vocabulary needed and left the rest
-- for when somebody asked for them. This is the rest: every named UK craft in
-- the brief's Appendix A2, transcribed on 13 September 2026 and written here in
-- Epic's own English. 221 of them, taking Crafts and making from sixty-two
-- words to two hundred and eighty.
--
-- **They are craft names and nothing else.** No grading, no status, no column
-- saying whether anybody still does one — that is somebody else's judgement
-- about a craft and not a fact about a skill, and Epic has no use for it. A
-- swill basket maker and a blacksmith are the same kind of row.
--
-- Why this is worth the rows: it is the long tail the whole tag layer exists
-- for. No marketplace taxonomy contains *withy pot making* or *Sussex trug
-- making*, and a host who finds their own craft already named is a host who
-- finishes the step. Every one is unmapped, like the rest — an identifier is
-- attached in the back office, one candidate at a time, by somebody who can
-- tell the craft from the article written about it.
--
-- Parents are set by hand, as they always are here: a keyword pass put each
-- under one of the fourteen crafts 102 already holds, and the ones it filed
-- wrongly were moved by eye — a split cane rod is for fishing rather than for
-- playing, gold leaf is metal, and a watchmaker is not a model maker.

-- The ones that sit at the top of their category.
insert into host_skill_tags (key, label, parent_key, category_key, seeded) values
  ('clock-making', 'Clock making', null, 'crafts', true),
  ('fly-dressing', 'Fly dressing', null, 'crafts', true),
  ('pigment-making', 'Pigment making', null, 'crafts', true),
  ('pysanka', 'Pysanka', null, 'crafts', true),
  ('scientific-and-optical-instrument-making', 'Scientific and optical instrument making', null, 'crafts', true),
  ('sieve-and-riddle-making', 'Sieve and riddle making', null, 'crafts', true),
  ('spectacle-making', 'Spectacle making', null, 'crafts', true),
  ('taxidermy', 'Taxidermy', null, 'crafts', true),
  ('umbrella-making', 'Umbrella making', null, 'crafts', true),
  ('watch-making', 'Watch making', null, 'crafts', true)
on conflict (key) do nothing;

-- …then the ones under a craft migration 102 already named.
insert into host_skill_tags (key, label, parent_key, category_key, seeded) values
  ('armour-and-helmet-making', 'Armour and helmet making', 'metalwork', 'crafts', true),
  ('arrowsmithing', 'Arrowsmithing', 'metalwork', 'crafts', true),
  ('automaton-making', 'Automaton making', 'modelmaking', 'crafts', true),
  ('bagpipe-making', 'Bagpipe making', 'instrument-making', 'music', true),
  ('basket-making', 'Basket making', 'basketry', 'crafts', true),
  ('basketwork-furniture-making', 'Basketwork furniture making', 'basketry', 'crafts', true),
  ('batik', 'Batik', 'textiles', 'crafts', true),
  ('beadworking', 'Beadworking', 'jewellery', 'crafts', true),
  ('bee-skep-making', 'Bee skep making', 'basketry', 'crafts', true),
  ('bell-founding', 'Bell founding', 'metalwork', 'crafts', true),
  ('besom-broom-making', 'Besom broom making', 'woodwork', 'crafts', true),
  ('bicycle-frame-making', 'Bicycle frame making', 'metalwork', 'crafts', true),
  ('billiard-snooker-and-pool-cue-making', 'Billiard, snooker and pool cue making', 'woodwork', 'crafts', true),
  ('block-printing', 'Block printing', 'printmaking', 'art-photography', true),
  ('boat-building-traditional-wooden', 'Boat building (traditional wooden)', 'woodwork', 'crafts', true),
  ('bow-making-musical', 'Bow making (musical)', 'instrument-making', 'music', true),
  ('bowed-felt-hat-making', 'Bowed felt hat making', 'textiles', 'crafts', true),
  ('bowyery', 'Bowyery', 'metalwork', 'crafts', true),
  ('braiding', 'Braiding', 'textiles', 'crafts', true),
  ('brass-musical-instrument-making', 'Brass musical instrument making', 'instrument-making', 'music', true),
  ('brick-making', 'Brick making', 'pottery', 'crafts', true),
  ('brilliant-cutting', 'Brilliant cutting', 'metalwork', 'crafts', true),
  ('brush-making', 'Brush making', 'woodwork', 'crafts', true),
  ('button-making', 'Button making', 'textiles', 'crafts', true),
  ('canal-art-and-boat-painting', 'Canal art and boat painting', 'woodwork', 'crafts', true),
  ('carpentry-and-joinery', 'Carpentry and joinery', 'woodwork', 'crafts', true),
  ('chain-making', 'Chain making', 'metalwork', 'crafts', true),
  ('chair-seating-and-caning', 'Chair seating and caning', 'woodwork', 'crafts', true),
  ('clay-pipe-making', 'Clay pipe making', 'pottery', 'crafts', true),
  ('clog-making', 'Clog making', 'woodwork', 'crafts', true),
  ('coach-building', 'Coach building', 'woodwork', 'crafts', true),
  ('coach-trimming', 'Coach trimming', 'textiles', 'crafts', true),
  ('cob-building', 'Cob building', 'stonework', 'crafts', true),
  ('coiled-straw-basket-making', 'Coiled straw basket making', 'basketry', 'crafts', true),
  ('coopering', 'Coopering', 'woodwork', 'crafts', true),
  ('copper-wheel-glass-engraving', 'Copper wheel glass engraving', 'glasswork', 'crafts', true),
  ('coppersmithing', 'Coppersmithing', 'metalwork', 'crafts', true),
  ('coppice-craft', 'Coppice crafts', 'bushcraft', 'crafts', true),
  ('coracle-making', 'Coracle making', 'woodwork', 'crafts', true),
  ('corn-dolly-making', 'Corn dolly making', 'textiles', 'crafts', true),
  ('cornish-hedging', 'Cornish hedging', 'stonework', 'crafts', true),
  ('corset-making', 'Corset making', 'textiles', 'crafts', true),
  ('cricket-ball-making', 'Cricket ball making', 'leatherwork', 'crafts', true),
  ('cricket-bat-making', 'Cricket bat making', 'woodwork', 'crafts', true),
  ('currach-making', 'Currach making', 'woodwork', 'crafts', true),
  ('cutlery-and-tableware-making', 'Cutlery and tableware making', 'metalwork', 'crafts', true),
  ('damask-weaving', 'Damask weaving', 'textiles', 'crafts', true),
  ('darkroom-photography', 'Darkroom photography', 'photography', 'art-photography', true),
  ('decorative-plasterworking', 'Decorative plasterworking', 'stonework', 'crafts', true),
  ('devon-stave-basket-making', 'Devon stave basket making', 'basketry', 'crafts', true),
  ('diamond-cutting', 'Diamond cutting', 'jewellery', 'crafts', true),
  ('drum-making', 'Drum making', 'instrument-making', 'music', true),
  ('dyeing', 'Dyeing', 'textiles', 'crafts', true),
  ('edge-tool-making', 'Edge tool making', 'metalwork', 'crafts', true),
  ('encaustic-tile-making', 'Encaustic tile making', 'pottery', 'crafts', true),
  ('engine-turned-engraving', 'Engine turned engraving', 'metalwork', 'crafts', true),
  ('fabric-pleating', 'Fabric pleating', 'textiles', 'crafts', true),
  ('fair-isle-knitting', 'Fair Isle knitting', 'textiles', 'crafts', true),
  ('fairground-art', 'Fairground art', 'woodwork', 'crafts', true),
  ('falconry-furniture-making', 'Falconry furniture making', 'woodwork', 'crafts', true),
  ('fan-making', 'Fan making', 'textiles', 'crafts', true),
  ('felting', 'Felting', 'textiles', 'crafts', true),
  ('fender-making', 'Fender making', 'textiles', 'crafts', true),
  ('figurehead-and-ship-carving', 'Figurehead and ship carving', 'woodwork', 'crafts', true),
  ('flax-hemp-and-nettle-processing', 'Flax, hemp and nettle processing', 'textiles', 'crafts', true),
  ('fletching', 'Fletching', 'metalwork', 'crafts', true),
  ('flintwork', 'Flintwork', 'stonework', 'crafts', true),
  ('flute-making', 'Flute making', 'instrument-making', 'music', true),
  ('folding-knife-making', 'Folding knife making', 'metalwork', 'crafts', true),
  ('fore-edge-painting', 'Fore edge painting', 'printmaking', 'art-photography', true),
  ('founding', 'Founding', 'metalwork', 'crafts', true),
  ('frame-knitting', 'Frame knitting', 'textiles', 'crafts', true),
  ('free-reed-instrument-making', 'Free reed instrument making', 'instrument-making', 'music', true),
  ('french-polishing', 'French polishing', 'woodwork', 'crafts', true),
  ('gansey-knitting', 'Gansey knitting', 'textiles', 'crafts', true),
  ('gauged-brickwork', 'Gauged brickwork', 'pottery', 'crafts', true),
  ('gilding', 'Gilding', 'metalwork', 'crafts', true),
  ('glass-eye-making', 'Glass eye making', 'glasswork', 'crafts', true),
  ('glass-working', 'Glass working', 'glasswork', 'crafts', true),
  ('globe-making', 'Globe making', 'modelmaking', 'crafts', true),
  ('glove-making', 'Glove making', 'textiles', 'crafts', true),
  ('gold-beating', 'Gold beating', 'metalwork', 'crafts', true),
  ('goldsmithing', 'Goldsmithing', 'metalwork', 'crafts', true),
  ('graining-and-marbling', 'Graining and marbling', 'woodwork', 'crafts', true),
  ('guitar-making', 'Guitar making', 'instrument-making', 'music', true),
  ('gunmaking', 'Gunmaking', 'metalwork', 'crafts', true),
  ('hand-engraving', 'Hand engraving', 'metalwork', 'crafts', true),
  ('handle-making', 'Handle making', 'woodwork', 'crafts', true),
  ('harp-making', 'Harp making', 'instrument-making', 'music', true),
  ('harris-tweed-weaving', 'Harris Tweed weaving', 'textiles', 'crafts', true),
  ('hat-block-making', 'Hat block making', 'textiles', 'crafts', true),
  ('hat-making', 'Hat making', 'textiles', 'crafts', true),
  ('hat-plaiting', 'Hat plaiting', 'textiles', 'crafts', true),
  ('hazel-basket-making', 'Hazel basket making', 'basketry', 'crafts', true),
  ('heritage-tiling-and-mosaic', 'Heritage tiling and mosaic', 'pottery', 'crafts', true),
  ('hewing', 'Hewing', 'woodwork', 'crafts', true),
  ('historic-stained-glass-window-making', 'Historic stained glass window making', 'glasswork', 'crafts', true),
  ('horn-antler-and-bone-working', 'Horn, antler and bone working', 'jewellery', 'crafts', true),
  ('horse-collar-making', 'Horse collar making', 'leatherwork', 'crafts', true),
  ('horsehair-weaving', 'Horsehair weaving', 'textiles', 'crafts', true),
  ('hurdle-making', 'Hurdle making', 'woodwork', 'crafts', true),
  ('illumination', 'Illumination', 'printmaking', 'art-photography', true),
  ('intaglio', 'Intaglio', 'printmaking', 'art-photography', true),
  ('islamic-calligraphy', 'Islamic calligraphy', 'calligraphy', 'art-photography', true),
  ('keyboard-instrument-making', 'Keyboard instrument making', 'instrument-making', 'music', true),
  ('kilt-making', 'Kilt making', 'textiles', 'crafts', true),
  ('knife-making', 'Knife making', 'metalwork', 'crafts', true),
  ('lace-making-bobbin-lace', 'Lace making (bobbin lace)', 'textiles', 'crafts', true),
  ('lacquerwork', 'Lacquerwork', 'woodwork', 'crafts', true),
  ('lacrosse-stick-making', 'Lacrosse stick making', 'woodwork', 'crafts', true),
  ('ladder-making', 'Ladder making', 'woodwork', 'crafts', true),
  ('lapidary', 'Lapidary', 'jewellery', 'crafts', true),
  ('leadworking', 'Leadworking', 'metalwork', 'crafts', true),
  ('leatherworking', 'Leatherworking', 'leatherwork', 'crafts', true),
  ('lime-plastering', 'Lime plastering', 'stonework', 'crafts', true),
  ('lithography', 'Lithography', 'printmaking', 'art-photography', true),
  ('lorinery', 'Lorinery', 'metalwork', 'crafts', true),
  ('lute-making', 'Lute making', 'instrument-making', 'music', true),
  ('macrame', 'Macramé', 'textiles', 'crafts', true),
  ('maille-making', 'Maille making', 'metalwork', 'crafts', true),
  ('marbling', 'Marbling', 'printmaking', 'art-photography', true),
  ('marionette-making', 'Marionette making', 'modelmaking', 'crafts', true),
  ('marquetry', 'Marquetry', 'woodwork', 'crafts', true),
  ('mechanical-organ-making', 'Mechanical organ making', 'instrument-making', 'music', true),
  ('medal-making', 'Medal making', 'metalwork', 'crafts', true),
  ('metal-spinning', 'Metal spinning', 'metalwork', 'crafts', true),
  ('metal-thread-making', 'Metal thread making', 'metalwork', 'crafts', true),
  ('millwrighting', 'Millwrighting', 'woodwork', 'crafts', true),
  ('model-engineering', 'Model engineering', 'modelmaking', 'crafts', true),
  ('mould-and-deckle-making', 'Mould and deckle making', 'printmaking', 'art-photography', true),
  ('mouth-blown-sheet-glass-making', 'Mouth blown sheet glass making', 'glasswork', 'crafts', true),
  ('nalbinding', 'Nalbinding', 'textiles', 'crafts', true),
  ('neon-making', 'Neon making', 'metalwork', 'crafts', true),
  ('net-making', 'Net making', 'textiles', 'crafts', true),
  ('northern-isle-basket-making', 'Northern Isles basket making', 'basketry', 'crafts', true),
  ('oar-mast-and-spar-making', 'Oar, mast and spar making', 'woodwork', 'crafts', true),
  ('organ-building', 'Organ building', 'instrument-making', 'music', true),
  ('orkney-chair-making', 'Orkney chair making', 'woodwork', 'crafts', true),
  ('orrery-making', 'Orrery making', 'modelmaking', 'crafts', true),
  ('paper-making', 'Paper making', 'printmaking', 'art-photography', true),
  ('parchment-and-vellum-making', 'Parchment and vellum making', 'leatherwork', 'crafts', true),
  ('pargeting-and-scagliola', 'Pargeting and scagliola', 'stonework', 'crafts', true),
  ('passementerie', 'Passementerie', 'textiles', 'crafts', true),
  ('patchwork', 'Patchwork', 'textiles', 'crafts', true),
  ('percussion-instrument-making', 'Percussion instrument making', 'instrument-making', 'music', true),
  ('pewter-working', 'Pewter working', 'metalwork', 'crafts', true),
  ('piano-making', 'Piano making', 'instrument-making', 'music', true),
  ('pietra-dura', 'Pietra dura', 'stonework', 'crafts', true),
  ('plane-making', 'Plane making', 'metalwork', 'crafts', true),
  ('plume-making', 'Plume making', 'textiles', 'crafts', true),
  ('pointe-shoe-making', 'Pointe shoe making', 'textiles', 'crafts', true),
  ('pole-lathe-turning', 'Pole lathe turning', 'woodwork', 'crafts', true),
  ('puppet-making', 'Puppet making', 'modelmaking', 'crafts', true),
  ('rake-making', 'Rake making', 'woodwork', 'crafts', true),
  ('rattan-furniture-making', 'Rattan furniture making', 'woodwork', 'crafts', true),
  ('reverse-glass-sign-painting', 'Reverse glass sign painting', 'glasswork', 'crafts', true),
  ('rigging', 'Rigging', 'textiles', 'crafts', true),
  ('rocking-horse-making', 'Rocking horse making', 'woodwork', 'crafts', true),
  ('rope-making', 'Rope making', 'textiles', 'crafts', true),
  ('rug-tufting', 'Rug tufting', 'textiles', 'crafts', true),
  ('rug-weaving', 'Rug weaving', 'textiles', 'crafts', true),
  ('rush-matting', 'Rush matting', 'basketry', 'crafts', true),
  ('sail-making', 'Sail making', 'textiles', 'crafts', true),
  ('saw-making', 'Saw making', 'metalwork', 'crafts', true),
  ('scissor-making', 'Scissor making', 'metalwork', 'crafts', true),
  ('sgian-dubh-and-dirk-making', 'Sgian dubh and dirk making', 'metalwork', 'crafts', true),
  ('shetland-lace-knitting', 'Shetland lace knitting', 'textiles', 'crafts', true),
  ('shinty-caman-making', 'Shinty caman making', 'woodwork', 'crafts', true),
  ('shoe-and-boot-making-handsewn', 'Shoe and boot making (handsewn)', 'leatherwork', 'crafts', true),
  ('side-saddle-making', 'Side saddle making', 'leatherwork', 'crafts', true),
  ('silk-ribbon-making', 'Silk ribbon making', 'textiles', 'crafts', true),
  ('silk-weaving', 'Silk weaving', 'textiles', 'crafts', true),
  ('silver-spinning', 'Silver spinning', 'metalwork', 'crafts', true),
  ('skeined-willow-working', 'Skeined willow working', 'basketry', 'crafts', true),
  ('slate-working', 'Slate working', 'stonework', 'crafts', true),
  ('smocking', 'Smocking', 'textiles', 'crafts', true),
  ('spade-making', 'Spade making', 'metalwork', 'crafts', true),
  ('spar-making', 'Spar making', 'woodwork', 'crafts', true),
  ('spinning-wheel-making', 'Spinning wheel making', 'textiles', 'crafts', true),
  ('split-cane-rod-making', 'Split cane rod making', 'woodwork', 'crafts', true),
  ('sporran-making', 'Sporran making', 'textiles', 'crafts', true),
  ('stained-glass-and-glass-painting', 'Stained glass and glass painting', 'glasswork', 'crafts', true),
  ('steel-pan-making', 'Steel pan making', 'metalwork', 'crafts', true),
  ('stick-dressing', 'Stick dressing', 'woodwork', 'crafts', true),
  ('stonemasonry', 'Stonemasonry', 'stonework', 'crafts', true),
  ('straw-hat-making', 'Straw hat making', 'textiles', 'crafts', true),
  ('straw-working', 'Straw working', 'textiles', 'crafts', true),
  ('stringed-instrument-making', 'Stringed instrument making', 'instrument-making', 'music', true),
  ('studio-pottery', 'Studio pottery', 'pottery', 'crafts', true),
  ('sussex-trug-making', 'Sussex trug making', 'basketry', 'crafts', true),
  ('swill-basket-making', 'Swill basket making', 'basketry', 'crafts', true),
  ('swordsmithing', 'Swordsmithing', 'metalwork', 'crafts', true),
  ('tanning-oak-bark-and-vegetable', 'Tanning (oak bark and vegetable)', 'leatherwork', 'crafts', true),
  ('tapestry-weaving', 'Tapestry weaving', 'textiles', 'crafts', true),
  ('tatting', 'Tatting', 'textiles', 'crafts', true),
  ('tile-making', 'Tile making', 'pottery', 'crafts', true),
  ('tinsmithing', 'Tinsmithing', 'metalwork', 'crafts', true),
  ('toy-making', 'Toy making', 'modelmaking', 'crafts', true),
  ('type-founding', 'Type founding', 'printmaking', 'art-photography', true),
  ('upholstery-and-soft-furnishing', 'Upholstery and soft furnishings', 'textiles', 'crafts', true),
  ('vardo-art-and-living-waggon-craft', 'Vardo art and living waggon crafts', 'woodwork', 'crafts', true),
  ('wainwrighting', 'Wainwrighting', 'woodwork', 'crafts', true),
  ('welsh-tapestry-weaving', 'Welsh tapestry weaving', 'textiles', 'crafts', true),
  ('wheelwrighting', 'Wheelwrighting', 'woodwork', 'crafts', true),
  ('whip-making', 'Whip making', 'leatherwork', 'crafts', true),
  ('wig-making', 'Wig making', 'textiles', 'crafts', true),
  ('withy-pot-making', 'Withy pot making', 'basketry', 'crafts', true),
  ('wooden-pipe-making', 'Wooden pipe making', 'woodwork', 'crafts', true),
  ('woodwind-instrument-making', 'Woodwind instrument making', 'woodwork', 'crafts', true)
on conflict (key) do nothing;

-- …and last, the two under a parent this migration has just made.
insert into host_skill_tags (key, label, parent_key, category_key, seeded) values
  ('origami', 'Origami', 'paper-making', 'crafts', true),
  ('quilling', 'Quilling', 'paper-making', 'crafts', true)
on conflict (key) do nothing;


-- The register says what was actually done, now that the whole inventory is in.
update vocabulary_sources set
  what_we_take = 'Craft and category names, rewritten in Epic''s voice. The Heritage Crafts inventory in full.',
  note = 'Craft Courses, ClassBento, Meetup and the Heritage Crafts inventory, read once on 13 September 2026 and transcribed into the brief''s Appendix A. A craft name is a few words and carries no copyright; what would carry weight is a compilation taken wholesale as live data, or a crawler run against somebody''s terms, and neither is happening — there is no scheduled job here and nothing refreshes. The names were rewritten and the list is Epic''s own. The grading the source publishes alongside its list is deliberately not taken: whether a craft is endangered is that charity''s judgement about the craft, not a fact about the skill, and Epic has no use for it (owner, 14 Sep 2026).',
  last_refreshed = now()
where key = 'read-by-hand';

-- One word that now belongs to somebody else.
--
-- 102 seeded "knife making" as an alias for Blacksmithing's *Bladesmithing*,
-- when there was no better row for it to mean. The inventory has both, and they
-- are different crafts — a bladesmith forges blades, a knife maker makes
-- knives, and the source lists them apart — so the alias has to let go, or the
-- new row could never be reached by its own name: `ensureAliases` writes a
-- self-alias only where the wording is free (Codex, 14 Sep 2026).
update host_skill_aliases set target_key = 'knife-making'
 where vocab = 'tag' and norm = 'knife making' and target_key = 'bladesmithing';

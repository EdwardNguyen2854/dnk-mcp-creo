# Fixtures

Integration tests need real Creo models open in a live session. Creo ships a
demo corpus that works well for this; it is never committed.

## Sandbox corpus

`fixtures/sandbox/` is a gitignored copy of Creo's demo models:

```
node scripts/fixture-models.mjs
```

Source: `<creo>\Common Files\demos\demo\mdx\tutorial1` (the slider-crank
tutorial: `slider_crank.asm` plus six part files). Re-run the script after a
Creo install change; existing files are left alone.

## Live read-pack smoke

With Creo running (or with `--launch`), from the repository root:

```
node scripts/read-pack-smoke.mjs
node scripts/read-pack-smoke.mjs --keep-open --keep-files
```

The smoke script:

1. attaches to Creo (or launches it with `--launch`),
2. copies the sandbox corpus into Creo's live working directory,
3. opens the fixture models with `model.open`,
4. exercises every read-pack bridge command and checks the payload shape,
5. closes the models it opened and removes the files it copied (unless
   `--keep-open` / `--keep-files`).

`--keep-open` is useful when you want to inspect the models in Creo after a run
that fails.

## Family tables

The demo corpus has no family-table generic. If `model.family_table` needs a
live regression fixture, author one small generic part in Creo, add it to
`fixtures/sandbox/`, and extend `scripts/read-pack-smoke.mjs` with a check.

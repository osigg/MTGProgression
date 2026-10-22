# Progression Pack Opener

A pack opener for a 4-player Magic: The Gathering Commander progression series, 1993 to 1999. Each player signs in with Google, opens their packs for the current round, and builds a collection they can filter, deck-check, and export to Archidekt with exact editions.

- **Packs** follow each set's real booster collation (slot counts and print-sheet odds from [taw/magic-sealed-data](https://github.com/taw/magic-sealed-data)). Card text comes from the [Forge](https://github.com/Card-Forge/forge) card database.
- **Players** open their own packs once per unlocked round. Openings can't be edited or deleted by players.
- **Admin** (the Google account in `js/firebase-config.js` and `firestore.rules`) unlocks rounds, voids mistakes, edits the ban list, and can open packs for anyone.

Hosting is GitHub Pages (free). Data and sign-in are Firebase on the free Spark plan. No credit card needed.

## Setup (about 10 minutes, one time)

### 1. Create the Firebase project
1. Go to <https://console.firebase.google.com> and click **Create a project**. Any name works, for example `mtg-progression`.
2. Google Analytics is optional. Turning it off is fine.

### 2. Register the web app and copy its config
1. On the project overview page, click the **Web** icon (`</>`) to add an app. Nickname: anything. Leave **Firebase Hosting** unchecked.
2. Firebase shows a `firebaseConfig = { ... }` block. Copy the values into `js/firebase-config.js`, replacing each `PASTE_ME`.
3. Commit and push that file. These values are safe to make public; the database rules protect the data.

### 3. Turn on Google sign-in
1. Left menu: **Build > Authentication > Get started**.
2. **Sign-in method** tab > **Google** > **Enable**. Pick your email as the support email. **Save**.

### 4. Create the database and publish the rules
1. Left menu: **Build > Firestore Database > Create database**.
2. Pick a location near you (for example `nam5 (United States)`). It can't be changed later.
3. Start in **production mode**.
4. Open the **Rules** tab, delete everything there, paste the full contents of `firestore.rules` from this repo, and click **Publish**.

### 5. Allow your GitHub Pages address to sign in
1. **Authentication > Settings > Authorized domains > Add domain**.
2. Add `osigg.github.io`.

### 6. Turn on GitHub Pages
1. In this repo on GitHub: **Settings > Pages**.
2. **Source**: Deploy from a branch. **Branch**: `main`, folder `/ (root)`. **Save**.
3. After a minute the site is live at <https://osigg.github.io/MTGProgression/>.

### 7. Check it
1. Open the site and sign in with the admin Google account. Pick your player name.
2. Go to **Players & bans > Run setup check**. Every line should be green.
3. Send the link to your friends. Each signs in with Google and picks a name.

## Running a round
- Players see and open only rounds up to the unlocked one. When everyone's done, the admin clicks **Unlock Round N** in **Players & bans**.
- If someone's opening goes wrong, the admin voids it in **History** and opens a replacement for them (admin can open for any player).
- Shared-pool picks go in **Open packs > Shared pool**, one per line with an edition: `Sol Ring (2ed) 270`.
- Bans go in **Players & bans > Ban list**. Collections and deck checks flag banned cards.

## Opening, stats and targets
- **Reveal**: choose *One pack at a time* (Next / Previous / Skip to all) or *All at once*. Either way, every pack is saved the moment you click Open, so closing the tab mid-reveal can't re-roll anything. The choice is remembered per browser.
- **What to expect** (Open packs tab): for each set in the round, the real pack layout, how often a pack holds 0, 1 or 2 rares, and the target cards with their odds, marked *Owned* if you already have one.
- **Stats tab**: per round or across all rounds, each player's packs, rares and targets as *actual / expected*, a luck score (targets hit vs. expected), legendary creatures and best pull, plus a list of every target pulled and a round checklist showing who owns each target.
- **Targets** are listed per set in `tools/targets.json`. Odds come from simulating 20,000 packs per set on the real print sheets. After editing the list, regenerate the odds with `node tools/odds.js` and push `data/odds.json`.

## Exporting to Archidekt and Tabletop Simulator
**Collections > Copy list** gives lines like `1x Force of Will (all) 28`. Paste them into Archidekt's collection import or a new deck. Then export the finished deck from Archidekt or Moxfield and load it into Tabletop Simulator with a deck importer such as [tts-deckconverter](https://github.com/jeandeaual/tts-deckconverter).

## Adding rounds
1. Add the new sets to `data/cards.json` (same structure as the existing sets: booster slots, sheets with weights, rarity and collector number per card).
2. Add a round entry to the `ROUNDS` list near the top of `js/app.js`.
3. Push. GitHub Pages updates in about a minute. Collections live in Firebase, so updates never touch them.

## Changing the admin
Change the email in **both** `js/firebase-config.js` and `firestore.rules`, push, and re-publish the rules in the Firebase console.

## Files
| Path | What it is |
|---|---|
| `index.html`, `css/style.css` | Page shell and styles |
| `js/app.js` | The app: opening, collections, deck check, history, admin |
| `js/backend.js` | Firebase sign-in and database calls |
| `js/firebase-config.js` | Your Firebase project config and the admin email |
| `firestore.rules` | Database security rules (paste into the Firebase console) |
| `data/cards.json` | Card text, booster sheets, rarities and collector numbers for all 20 sets |
| `data/odds.json` | Simulated real-pack odds and target lists (generated) |
| `tools/targets.json`, `tools/odds.js` | Editable target lists and the script that builds `data/odds.json` |

# LinkedIn post draft

> I've been learning to build privacy-preserving smart contracts on **Midnight**, and this week I shipped my
> first zero-knowledge contract end to end. 🚀

I wrote `hello-world.compact` — four lines of logic that store and read a message on-chain:

```compact
pragma language_version >= 0.23;
import CompactStandardLibrary;

export ledger message: Opaque<"string">;

export circuit storeMessage(newMessage: Opaque<"string">): [] {
  message = disclose(newMessage);
}
```

The code is tiny. What it took to make it real is not.

Over the last few days I:
🔹 set up a full TypeScript + Midnight SDK project (`midnight-js` 4.1.1, `wallet-sdk` 1.2.0);
🔹 compiled the contract into zero-knowledge circuits, JS bindings, and ZK intermediate representation;
🔹 stood up a local proof server in Docker and got it healthy on `127.0.0.1:6300`;
🔹 wired up the **three-wallet architecture** — shielded, unshielded, and DUST — behind a single HD seed;
🔹 wrote a cross-platform compile wrapper so the toolchain works on Windows (where `compact` collides with
Windows' own disk-compression tool, and where the Compact CLI has no native build).

Here's the honest part: **I hit a real wall.** The compiler's key generator (`zkir`) uses Intel ADX
instructions, and my machine runs a Haswell i5-4210U — predating ADX — so proving-key generation dies with a
`SIGILL`. I confirmed it wasn't my code: the contract compiles to JS and ZKIR perfectly, `tsc` passes, and the
failure is purely hardware-level. I even tried emulating the binary — no dice. Documenting a blocker precisely
is still progress.

Committing to learn this has already paid off:
✅ I now understand how zero-knowledge proofs, ledger state, and `disclose()` actually fit together.
✅ I can reason about Midnight's wallet and DUST model instead of treating it as a black box.
✅ I learned to debug at the *toolchain* level, not just the code level — reading kernel traps, compiler
versions, and dependency compatibility (compiler 0.31.1 ↔ runtime 0.16.0).
✅ The whole project is documented, reproducible, and on GitHub.

The bigger lesson: mastery isn't avoiding blockers — it's pinpointing them, documenting them honestly, and
keeping the rest of the system provably correct. Next stop: run the deploy on an ADX-capable runner, store
"Hello from Midnight!" on Preprod, and read it back from the ledger.

If you're exploring privacy tech, ZK, or Midnight, I'd love to compare notes. 👇

#Midnight #ZeroKnowledge #Blockchain #CompactLang #Web3 #PrivacyTech #DeveloperJourney #LearningInPublic

---

### Shorter variant (if you want a punchier post)

> I just built my first zero-knowledge smart contract on @Midnight — and learned more from the wall I hit
> than from the code that worked. 🧵

Four lines of Compact store a message on-chain. Getting there meant compiling to ZK circuits, running a local
proof server, and wiring Midnight's shielded + unshielded + DUST wallets together behind one seed.

Then I hit a hardware wall: the key generator needs Intel ADX, and my Haswell laptop doesn't have it. Instead
of guessing, I proved it: contract → JS/ZKIR ✅, TypeScript ✅, proof server ✅, key gen ❌ with a precise SIGILL.

Committing to this taught me to debug the *toolchain*, not just the code — compiler/runtime version pairing,
kernel traps, and honestly documenting a blocker. That's the skill that transfers.

Next: deploy on an ADX-capable runner and read "Hello from Midnight!" back from Preprod. 🚀

#Midnight #ZeroKnowledge #Blockchain #CompactLang #LearningInPublic

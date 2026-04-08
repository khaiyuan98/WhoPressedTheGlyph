const tips = [
  {
    icon: "🛡",
    title: "What It Does",
    description:
      "Makes all your team's buildings invulnerable for a brief moment, saving them from any attack.",
  },
  {
    icon: "⏱",
    title: "5-Minute Cooldown",
    description:
      "The Glyph has a 5-minute cooldown shared across your entire team — every player uses the same one.",
  },
  {
    icon: "🔄",
    title: "Cooldown Resets on Tower Loss",
    description:
      "The first time a Tier 1, Tier 2, or melee barracks is destroyed, your Glyph cooldown fully resets — giving you a fresh Glyph at each stage of the game.",
  },
  {
    icon: "🏠",
    title: "Save Your Base",
    description:
      "Best used when the enemy is pushing your base with multiple heroes and your buildings are under heavy attack.",
  },
  {
    icon: "👀",
    title: "Watch the Enemy Glyph",
    description:
      "When you push the enemy base, check their Glyph cooldown — if it's ready, expect them to use it to buy time for a defend.",
  },
  {
    icon: "⚠️",
    title: "Don't Waste It",
    description:
      "Avoid using it on a single building when the threat isn't critical — you only get it back when the next tower falls.",
  },
  {
    icon: "🤝",
    title: "Anyone Can Press It",
    description:
      "Any player on the team can activate the Glyph — communicate with your team to avoid wasting it accidentally.",
  },
];

export default function GlyphTips() {
  return (
    <div className="w-full max-w-2xl">
      <h2 className="text-base font-bold text-amber-400 mb-3 text-center">
        💡 Glyph of Fortification Tips
      </h2>
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
        {tips.map((tip) => (
          <div
            key={tip.title}
            className="bg-gray-800/50 border border-gray-700 rounded-lg p-3 flex gap-2.5"
          >
            <span className="text-lg flex-shrink-0 leading-snug">{tip.icon}</span>
            <div>
              <p className="text-sm font-semibold text-amber-300 leading-snug">
                {tip.title}
              </p>
              <p className="text-xs text-gray-400 mt-0.5 leading-relaxed">
                {tip.description}
              </p>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

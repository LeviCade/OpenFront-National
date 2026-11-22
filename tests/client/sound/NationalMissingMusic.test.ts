import { EventBus } from "@openfront/shared/EventBus";
import { afterEach, describe, expect, it, vi } from "vitest";

const { createHowl } = vi.hoisted(() => ({ createHowl: vi.fn() }));
vi.mock("howler", () => ({
  Howl: class {
    constructor(options: unknown) {
      createHowl(options);
    }
  },
  Howler: { volume: vi.fn() },
}));

import type { AudioMixer } from "../../../src/client/sound/AudioMixer";
import { startMenuMusic } from "../../../src/client/sound/MenuMusic";
import { SoundManager } from "../../../src/client/sound/SoundManager";
import { PlaySoundEffectEvent } from "../../../src/client/sound/Sounds";

describe("NATIONAL shipped soundtrack fallback", () => {
  afterEach(() => vi.clearAllMocks());

  it("never constructs or fetches absent music, even after gestures and mixer changes", () => {
    let audible = false;
    const listeners = new Set<(category: "music") => void>();
    const mixer = {
      isAudible: () => audible,
      volumeFor: () => (audible ? 1 : 0),
      register: vi.fn(),
      unregister: vi.fn(),
      play: vi.fn(),
      onChange: (listener: (category: "music") => void) => {
        listeners.add(listener);
        return () => listeners.delete(listener);
      },
    };
    const audio = mixer as unknown as AudioMixer;
    const bus = new EventBus();
    startMenuMusic(audio);
    const manager = new SoundManager(bus, audio);
    try {
      manager.playBackgroundMusic();
      for (let i = 0; i < 6; i++) {
        audible = !audible;
        for (const listener of listeners) listener("music");
        document.dispatchEvent(new Event("pointerdown"));
        document.dispatchEvent(new Event("keydown"));
        document.dispatchEvent(new Event("game-starting"));
        document.dispatchEvent(new Event("menu-restored"));
        manager.stopBackgroundMusic();
        manager.playBackgroundMusic();
      }
      expect(createHowl).not.toHaveBeenCalled();
      expect(mixer.register).not.toHaveBeenCalled();
      manager.playSoundEffect("victory");
      expect(mixer.play).toHaveBeenCalledWith("victory");
      bus.emit(new PlaySoundEffectEvent("click"));
      expect(mixer.play).toHaveBeenCalledWith("click");
    } finally {
      manager.dispose();
    }
    expect(listeners.size).toBe(0);
  });
});

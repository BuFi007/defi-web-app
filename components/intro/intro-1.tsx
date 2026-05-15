"use client";

import Image from "next/image";
import { useIsMac } from "@/components/hotkeys/hooks/use-is-mac";
import { telaranaImgAlt, telaranaImgSrc } from "@/utils";
import AnimatedBackground from "../animated-background";
import styles from "@/app/alpha/alpha-form.module.scss";

type Intro1Props = {
  abyss?: boolean;
};

export default function Intro1({ abyss = false }: Intro1Props) {
  const isMac = useIsMac();
  const modifier = isMac ? "⌘" : "Ctrl";

  return (
    <main
      className={`${styles.introShell} ${abyss ? styles.abyss : ""}`}
      data-abyss={abyss ? "on" : "off"}
    >
      <AnimatedBackground className={styles.introBackground} />

      <div className={styles.introTelaranaLayer} data-abyss-hide>
        <Image
          src={telaranaImgSrc}
          alt={telaranaImgAlt}
          fill
          priority
          sizes="100vw"
          className={styles.introTelarana}
        />
      </div>

      <div className={styles.introContent}>
        <h1 className={styles.introTitle} data-abyss-hide>
          Welcome to Telaraña
        </h1>
        <p className={styles.introHint} data-abyss-hide>
          Press
          <kbd className={styles.introKbd}>{modifier}</kbd>
          <kbd className={styles.introKbd}>K</kbd>
          or
          <kbd className={styles.introKbd}>Enter</kbd>
          to continue
        </p>
      </div>
    </main>
  );
}

"use client";

import Image from "next/image";
import { AnimatePresence, motion, useReducedMotion } from "framer-motion";
import { Loader2 } from "lucide-react";
import { useRouter, useSearchParams } from "next/navigation";
import { ReactTyped } from "react-typed";
import {
  useEffect,
  useMemo,
  useRef,
  useState,
  type ComponentProps,
} from "react";
import { Backlight } from "@/components/magicui/backlight";
import { DiaTextReveal } from "@/components/magicui/dia-text-reveal";
import { TypingAnimation } from "@/components/magicui/typing-animation";
import styles from "@/app/alpha/alpha-form.module.scss";
import { easeOut, reveal } from "@/utils/animations";
import { getSafePath as getSafeNextPath } from "@/utils/safe-path";
import { bufiColors } from "@/utils/theme";
import { telaranaAccessLabel } from "@/utils";

export default function Intro2() {
  const router = useRouter();

  const searchParams = useSearchParams();
  const reduceMotion = useReducedMotion();
  const shellRef = useRef<HTMLElement>(null);
  const ghostRef = useRef<HTMLDivElement>(null);
  const redirectTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const next = useMemo(
    () => getSafeNextPath(searchParams.get("next")),
    [searchParams],
  );

  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [isUnlocked, setIsUnlocked] = useState(false);

  useEffect(() => {
    if (reduceMotion || !ghostRef.current) {
      return;
    }

    let context: { revert: () => void } | undefined;
    let cancelled = false;

    import("gsap").then(({ gsap }) => {
      if (cancelled || !ghostRef.current || !shellRef.current) {
        return;
      }

      context = gsap.context(() => {
        gsap.set(ghostRef.current, {
          opacity: 0,
          scale: 0.72,
          xPercent: 16,
          rotate: -1.6,
          transformOrigin: "52% 18%",
          filter: "blur(10px)",
        });

        gsap.to(ghostRef.current, {
          opacity: 1,
          scale: 1,
          xPercent: 0,
          rotate: 0,
          filter: "blur(0px)",
          duration: 1.35,
          ease: "power4.out",
        });

        gsap.to(ghostRef.current, {
          yPercent: -1.8,
          rotate: 0.35,
          duration: 5.4,
          ease: "sine.inOut",
          repeat: -1,
          yoyo: true,
          delay: 1.1,
        });
      }, shellRef);
    });

    return () => {
      cancelled = true;
      context?.revert();
    };
  }, [reduceMotion]);

  useEffect(() => {
    return () => {
      if (redirectTimeoutRef.current) {
        clearTimeout(redirectTimeoutRef.current);
      }
    };
  }, []);

  const submit: NonNullable<ComponentProps<"form">["onSubmit"]> = async (
    event,
  ) => {
    event.preventDefault();
    if (isSubmitting || isUnlocked) {
      return;
    }

    setError("");
    setIsSubmitting(true);
    let unlocked = false;

    try {
      const response = await fetch("/api/alpha-gate", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ password }),
      });

      if (!response.ok) {
        setError("Could not unlock alpha access");
        return;
      }

      const data = (await response.json()) as { ok?: boolean };

      if (!data.ok) {
        setError("Wrong password");
        return;
      }

      setIsUnlocked(true);
      unlocked = true;
      redirectTimeoutRef.current = setTimeout(
        () => {
          window.location.assign(next);
          router.refresh();
        },

        reduceMotion ? 0 : 850,
      );
    } catch {
      setError("Could not unlock alpha access");
    } finally {
      if (!unlocked) {
        setIsSubmitting(false);
      }
    }
  };

  return (
    <main ref={shellRef} className={styles.shell}>
      <div className={styles.referenceWash} aria-hidden="true" />
      <div className={styles.fogOne} aria-hidden="true" />
      <div className={styles.fogTwo} aria-hidden="true" />

      <div ref={ghostRef} className={styles.heroGhost} aria-hidden="true">
        <Backlight blur={22} className={styles.heroGhostBacklight}>
          <Image
            src="/assets/sticker-bu-hero.png"
            alt=""
            fill
            priority
            sizes="(max-width: 860px) 610px, 1500px"
            className={styles.heroGhostImage}
          />
        </Backlight>
      </div>

      <motion.section
        className={styles.content}
        aria-label="BUFI alpha password"
        animate={
          isUnlocked
            ? { opacity: 0, scale: 0.94, y: -10, filter: "blur(10px)" }
            : { opacity: 1, scale: 1, y: 0, filter: "blur(0px)" }
        }
        transition={{ duration: 0.5, ease: easeOut }}
      >
        <motion.div
          className={styles.wordmarkWrap}
          variants={reveal}
          initial="hidden"
          animate="visible"
          custom={0.1}
        >
          <Image
            src="/assets/tipografico-alpha.png"
            alt="BU.FI"
            width={743}
            height={256}
            priority
            className={styles.wordmark}
          />
        </motion.div>

        <motion.div
          className={styles.headlineRow}
          variants={reveal}
          initial="hidden"
          animate="visible"
          custom={0.2}
        >
          <p className={styles.alphaLabel}>
            <DiaTextReveal
              text="Alpha"
              colors={bufiColors}
              textColor="var(--alpha-purple)"
              duration={0.25}
              delay={0.05}
              startOnView={false}
            />
          </p>
          <span className={styles.protocol}>{telaranaAccessLabel}</span>
        </motion.div>

        <motion.h1
          className={styles.title}
          variants={reveal}
          initial="hidden"
          animate="visible"
          custom={0.26}
        >
          <TypingAnimation
            delay={80}
            duration={18}
            renderText={(text) => (
              <DiaTextReveal
                text={text || "\u00a0"}
                colors={bufiColors}
                textColor="var(--alpha-purple)"
                duration={0.18}
                delay={0}
                startOnView={false}
              />
            )}
          >
            Enter password
          </TypingAnimation>
        </motion.h1>

        <motion.form
          onSubmit={submit}
          className={styles.form}
          variants={reveal}
          initial="hidden"
          animate="visible"
          custom={0.34}
        >
          <label className={styles.passwordPill}>
            <span className={styles.srOnly}>Alpha password</span>
            <input
              type="password"
              value={password}
              onChange={(event) => setPassword(event.target.value)}
              autoFocus
              className={styles.input}
              aria-invalid={Boolean(error)}
              aria-describedby={error ? "alpha-error" : undefined}
            />
            {password.length === 0 && (
              <span className={styles.typedPlaceholder} aria-hidden="true">
                <ReactTyped
                  strings={["We make spooky things easy"]}
                  typeSpeed={55}
                  startDelay={1000}
                  showCursor
                  cursorChar="|"
                />
              </span>
            )}
          </label>
          <p id="alpha-error" className={styles.feedback} aria-live="polite">
            {error}
          </p>
        </motion.form>
      </motion.section>

      <AnimatePresence>
        {isUnlocked ? (
          <motion.div
            className={styles.successLoader}
            initial={{ opacity: 0, scale: 0.86, y: 12 }}
            animate={{ opacity: 1, scale: 1, y: 0 }}
            exit={{ opacity: 0, scale: 0.94, y: -8 }}
            transition={{ duration: 0.42, ease: easeOut }}
            role="status"
            aria-live="polite"
            aria-label="Unlocking alpha"
          >
            <motion.div
              animate={{ rotate: 360 }}
              transition={{
                duration: 0.82,
                ease: "linear",
                repeat: Infinity,
              }}
              className={styles.loaderRing}
            >
              <Loader2 aria-hidden="true" />
            </motion.div>
          </motion.div>
        ) : null}
      </AnimatePresence>
    </main>
  );
}

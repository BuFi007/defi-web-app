"use client";

import Image from "next/image";
import { motion, useReducedMotion, Variants } from "framer-motion";
import { useRouter, useSearchParams } from "next/navigation";
import { FormEvent, useEffect, useMemo, useRef, useState } from "react";
import styles from "./alpha-form.module.css";

const getSafeNextPath = (value: string | null) => {
  if (!value || !value.startsWith("/") || value.startsWith("//")) {
    return "/";
  }

  if (value === "/alpha" || value.startsWith("/alpha?")) {
    return "/";
  }

  return value;
};

const easeOut = [0.23, 1, 0.32, 1] as const;

const reveal: Variants = {
  hidden: { opacity: 0, transform: "translateY(18px)" },
  visible: (delay: number = 0) => ({
    opacity: 1,
    transform: "translateY(0)",
    transition: {
      delay,
      duration: 0.62,
      ease: easeOut,
    },
  }),
};

export const AlphaForm = () => {
  const router = useRouter();
  const searchParams = useSearchParams();
  const reduceMotion = useReducedMotion();
  const shellRef = useRef<HTMLElement>(null);
  const ghostRef = useRef<HTMLDivElement>(null);
  const next = useMemo(
    () => getSafeNextPath(searchParams.get("next")),
    [searchParams],
  );

  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [isSubmitting, setIsSubmitting] = useState(false);

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

  const submit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setError("");
    setIsSubmitting(true);

    try {
      const response = await fetch("/api/alpha-gate", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ password }),
      });

      if (!response.ok) {
        setError("Wrong password");
        return;
      }

      router.replace(next);
      router.refresh();
    } catch {
      setError("Could not unlock alpha access");
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <main ref={shellRef} className={styles.shell}>
      <div className={styles.referenceWash} aria-hidden="true" />
      <div className={styles.fogOne} aria-hidden="true" />
      <div className={styles.fogTwo} aria-hidden="true" />

      <div ref={ghostRef} className={styles.heroGhost} aria-hidden="true">
        <Image
          src="/assets/sticker-bu.png"
          alt=""
          width={984}
          height={1024}
          priority
          className={styles.heroGhostImage}
        />
      </div>

      <section className={styles.content} aria-label="BUFI alpha password">
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
          <p className={styles.alphaLabel}>Alpha</p>
          <span className={styles.protocol}>fx-telaraña-protocol v.0.!</span>
        </motion.div>

        <motion.h1
          className={styles.title}
          variants={reveal}
          initial="hidden"
          animate="visible"
          custom={0.26}
        >
          Enter password
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
              placeholder="We make spooky things easy"
              autoFocus
              className={styles.input}
              aria-invalid={Boolean(error)}
              aria-describedby={error ? "alpha-error" : undefined}
            />
          </label>
          <button className={styles.submit} type="submit" disabled={isSubmitting}>
            {isSubmitting ? "Unlocking" : "Unlock alpha"}
          </button>
          <p id="alpha-error" className={styles.feedback} aria-live="polite">
            {error}
          </p>
        </motion.form>
      </section>
    </main>
  );
};

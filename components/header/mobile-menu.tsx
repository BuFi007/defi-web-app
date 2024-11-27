"use client";

import React, { useState } from "react";
import Link from "next/link";
import Image from "next/image";
import { motion, AnimatePresence } from "framer-motion";
import { ModeToggle } from "@/components/theme-toggle";
import LocalSwitcher from "@/components/locale-switcher";
import { DynamicWidget } from "@dynamic-labs/sdk-react-core";
import dynamic from "next/dynamic";

const AnimatedBackground = dynamic(() => import("@/components/lottie-wrapper"), { ssr: false });

const MobileMenu: React.FC = () => {
  const [isOpen, setIsOpen] = useState(false);

  const toggleMenu = () => setIsOpen(!isOpen);

  return (
    <div className="container mx-auto px-4">
      <div className="flex justify-between items-center py-4">
        <Link href="/">
          <Image
            src="/images/BooFi-icon.png"
            alt="Logo"
            width={50}
            height={50}
          />
        </Link>
        <button
          onClick={toggleMenu}
          className="z-100 relative w-10 h-10 text-gray-500 hover:text-gray-700 focus:outline-none"
        >
          <span className="sr-only">Open main menu</span>
          <div className="absolute left-1/2 top-1/2 block w-5 transform -translate-x-1/2 -translate-y-1/2">
            <span
              aria-hidden="true"
              className={`block absolute h-0.5 w-5 bg-current transform transition duration-500 ease-in-out ${
                isOpen ? "rotate-45" : "-translate-y-1.5"
              }`}
            ></span>
            <span
              aria-hidden="true"
              className={`block absolute h-0.5 w-5 bg-current transform transition duration-500 ease-in-out ${
                isOpen ? "opacity-0" : ""
              }`}
            ></span>
            <span
              aria-hidden="true"
              className={`block absolute h-0.5 w-5 bg-current transform transition duration-500 ease-in-out ${
                isOpen ? "-rotate-45" : "translate-y-1.5"
              }`}
            ></span>
          </div>
        </button>
      </div>
      <AnimatePresence>
        {isOpen && (
          <motion.div
            initial={{ opacity: 0, y: -20 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -20 }}
            transition={{ duration: 0.3 }}
            className="fixed inset-0 z-40 bg-background"
          >
            <AnimatedBackground />
            <div className="flex flex-col items-center justify-center h-full space-y-8">
              <Link href="/" className="text-2xl font-bold" onClick={toggleMenu}>
                Home
              </Link>
              <div className="flex items-center space-x-4">
                <ModeToggle />
                <LocalSwitcher />
              </div>
              <DynamicWidget />
              </div>
          </motion.div>

        )}
      </AnimatePresence>
    </div>
  );
};

export default MobileMenu;


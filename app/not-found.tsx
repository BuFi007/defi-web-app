'use client'

import React from "react";
import { motion } from "framer-motion";
import { Button } from "@/components/ui/button";

export default function NotFound() {
  return (
    <div className="grid h-screen place-content-center bg-background px-4">
      <motion.div 
        className="text-center"
        initial={{ opacity: 0, y: -50 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.5 }}
      >
        <motion.span 
          className="text-8xl inline-block"
          animate={{ 
            y: [0, -20, 0],
            rotate: [0, 10, -10, 0]
          }}
          transition={{ 
            duration: 2,
            repeat: Infinity,
            repeatType: "reverse"
          }}
        >
          👻
        </motion.span>

        <motion.h1 
          className="mt-6 text-4xl font-bold tracking-tight text-foreground sm:text-6xl"
          initial={{ scale: 0.5 }}
          animate={{ scale: 1 }}
          transition={{ delay: 0.2, type: "spring", stiffness: 120 }}
        >
          Boo-hoo! Page Not Found
        </motion.h1>

        <motion.p 
          className="mt-4 text-lg text-muted-foreground"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          transition={{ delay: 0.4 }}
        >
          Looks like this page has ghosted you! Don't worry, our spirits are high and we'll help you find your way back.
        </motion.p>

        <motion.div
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.6 }}
        >
          <Button
            variant="charly"
            size="lg"
            className="mt-8"
            onClick={() => window.location.href = '/'}
          >
            Exorcise this error
          </Button>
        </motion.div>
      </motion.div>
    </div>
  );
}
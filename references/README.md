# References

External repositories cloned (shallow, blobs filtered where the host
allows) for direct reading during matcher implementation. **Not** runtime
dependencies. This entire directory is gitignored.

Catalogue + reading order: see `../docs/matcher-architecture.md` →
"## Reference implementations".

## Refresh

```bash
# One repo
git -C references/<name> pull --depth=1

# All (parallel)
ls references/*/.git -d 2>/dev/null \
  | xargs -P 8 -I{} sh -c 'git -C "$(dirname {})" pull --depth=1'
```

## Re-clone from scratch

```bash
rm -rf references/* && bash references/clone-all.sh
```

(See `clone-all.sh` for the full list.)

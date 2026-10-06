import { WeaponName } from 'csdm/common/types/counter-strike';
import { InvalidArgument } from 'csdm/cli/errors/invalid-argument';

function normalize(value: string) {
  return value.toLowerCase().replaceAll(/[^a-z0-9]/g, '');
}

/**
 * Parses a comma-separated list of weapons, e.g. "ak47,awp,deagle".
 * Each weapon can be the weapon name ("AK-47", "Desert Eagle") or its identifier ("AK47", "Deagle"), case and
 * punctuation insensitive.
 */
export function parseWeaponNames(value: string): WeaponName[] {
  const weaponNames: WeaponName[] = [];
  for (const rawName of value.split(',')) {
    const name = normalize(rawName);
    if (name === '') {
      continue;
    }

    const entry = Object.entries(WeaponName).find(([key, weaponName]) => {
      return normalize(key) === name || normalize(weaponName) === name;
    });
    if (!entry) {
      throw new InvalidArgument(`Unknown weapon: ${rawName}. Available values: ${Object.keys(WeaponName).join(', ')}`);
    }
    weaponNames.push(entry[1]);
  }

  return weaponNames;
}

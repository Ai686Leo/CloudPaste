let mountsVersion = Date.now();

export const getMountsVersion = () => mountsVersion;

export const bumpMountsVersion = () => {
  mountsVersion = Date.now();
  return mountsVersion;
};

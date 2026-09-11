import { describe, expect, it } from 'vitest';
import { repositoryImageRequest } from './githubImages';

const locator = { profileId: 'work', owner: 'VosoBrands', repository: 'hive', number: 931 };

describe('authenticated PR repository images', () => {
  it('resolves the private blob screenshots used in PR descriptions', () => {
    expect(repositoryImageRequest('https://github.com/VosoBrands/hive/blob/03358f071/docs/image.jpg?raw=true', 'github.com', locator)).toEqual({
      endpoint: 'repos/VosoBrands/hive/contents/docs/image.jpg?ref=03358f071', mime: 'image/jpeg'
    });
    expect(repositoryImageRequest('https://raw.githubusercontent.com/VosoBrands/hive/main/docs/screen%20shot.png', 'github.com', locator)?.endpoint).toBe('repos/VosoBrands/hive/contents/docs/screen%20shot.png?ref=main');
  });
  it('does not authenticate external, cross-repository or non-image links', () => {
    for (const source of [
      'https://evil.example/VosoBrands/hive/blob/main/image.png',
      'https://github.com/someone/private/blob/main/image.png',
      'https://github.com/VosoBrands/hive/blob/main/secrets.txt',
      'https://github.com/VosoBrands/hive/blob/main/image.svg',
      'https://github.com/VosoBrands/hive/blob/main/docs%2Fimage.png',
      'http://github.com/VosoBrands/hive/blob/main/image.png'
    ]) expect(repositoryImageRequest(source, 'github.com', locator)).toBeUndefined();
  });
});

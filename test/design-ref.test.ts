import { describe, expect, it } from 'vitest';
import { parseDesignRef } from '../src/pictures/design-ref.js';

describe('parseDesignRef', () => {
  it('accepts a design id and a Sketchpad link', () => {
    expect(parseDesignRef('SPfernCare1')).toBe('SPfernCare1');
    expect(parseDesignRef(' https://sketchpad.example/design/SPfernCare1/edit ')).toBe('SPfernCare1');
    expect(parseDesignRef('https://sketchpad.example/design/SPfernCare1?page=2')).toBe('SPfernCare1');
  });

  it.each([
    ['plain http', 'http://sketchpad.example/design/SPfernCare1'],
    ['another host', 'https://sketchpad.example.evil.test/design/SPfernCare1'],
    ['a look-alike host', 'https://sketchpad-example.test/design/SPfernCare1'],
    ['a port', 'https://sketchpad.example:8443/design/SPfernCare1'],
    ['a user name', 'https://someone@sketchpad.example/design/SPfernCare1'],
    ['another path', 'https://sketchpad.example/folder/SPfernCare1'],
    ['a malformed id', 'https://sketchpad.example/design/SP..%2F..%2Fadmin'],
    ['a file', 'data:image/png;base64,iVBORw0KGgo='],
    ['a short id', 'SPfern'],
  ])('refuses %s', (_case, input) => {
    expect(parseDesignRef(input)).toBeUndefined();
  });
});

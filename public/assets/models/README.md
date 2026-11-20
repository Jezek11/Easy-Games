# Custom `.glb` Models Directory

This folder is ready for your own downloaded `.glb` character and weapon models using `THREE.GLTFLoader`.

## Supported Filenames
Drop any of these files into `public/assets/models/`:
- `character.glb` — Custom player / bot character model (Y-up, facing forward, feet near `y = 0`). Optional skeletal clips named `idle`, `walk`, or `run` are picked up automatically.
- `shotgun.glb` — Custom Pump Shotgun model.
- `ar.glb` — Custom Assault Rifle model.
- `pickaxe.glb` — Custom Pickaxe / harvesting tool model.
- `structures.glb` — Optional custom building geometries (disabled by default so procedural Canvas Wood/Brick/Metal textures render).

## How to Activate Custom `.glb` Models
Open `public/js/game/modelLoader.js` and change the single master toggle at the top of `MODEL_CONFIG`:

```js
export const MODEL_CONFIG = {
  useCustomModels: true,
  ...
};
```

You can also toggle it live in the browser DevTools console for testing:
```js
window.XGAMES_MODELS.setUseCustomModels(true);
```

If any `.glb` file is missing or fails to load, the game automatically falls back to the built-in stylized 3D models without crashing.

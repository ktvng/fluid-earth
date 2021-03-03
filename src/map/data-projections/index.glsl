#pragma glslify: export(projectToTexture)

const float PI = radians(180.0);
const float PI_2 = radians(90.0);

void projectToTexture(
    out vec2 textureCoord,
    in vec2 lonLat,
    in float gridWidth,
    in float gridHeight,
    in int projection
) {
  // GFS
  if (projection == 0) {

    textureCoord = (lonLat + vec2(0, PI_2)) / vec2(2.0 * PI, PI);

    float xOffset = 0.5 / gridWidth;
    float yScale = (gridHeight - 1.0) / gridHeight;

    textureCoord.x = mod(textureCoord.x + xOffset, 1.0);
    textureCoord.y = yScale * (textureCoord.y - 0.5) + 0.5;
  }
  // RTGSSTHR
  else if (projection == 1) {

    textureCoord = (lonLat + vec2(0, PI_2)) / vec2(2.0 * PI, PI);
    textureCoord.x = mod(textureCoord.x, 1.0);
  }
}
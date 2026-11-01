import java.awt.image.BufferedImage;
import javax.imageio.ImageIO;
import java.io.File;
/** Packs generated, registered artwork into soft-edged expression layers. No external artwork. */
public class PrepareArtwork {
  public static void main(String[] args) throws Exception {
    File dir=new File(args[0]); BufferedImage face=ImageIO.read(new File(dir,"expressions.png"));
    int[][] boxes={{490,212,126,98},{599,260,122,100},{498,330,128,106}};
    String[] names={"eyelidR","eyelidL","mouth"};
    for(int i=0;i<boxes.length;i++) {
      int[] b=boxes[i]; BufferedImage tile=new BufferedImage(b[2],b[3],BufferedImage.TYPE_INT_ARGB);
      for(int y=0;y<b[3];y++) for(int x=0;x<b[2];x++) {
        int rgba=face.getRGB(b[0]+x,b[1]+y);
        double d=Math.hypot((x-b[2]/2.0)/(b[2]/2.0),(y-b[3]/2.0)/(b[3]/2.0));
        double t=Math.max(0,Math.min(1,(1-d)/.25)); double a=t*t*(3-2*t);
        tile.setRGB(x,y,((int)(((rgba>>>24)&255)*a)<<24)|(rgba&0xffffff));
      }
      ImageIO.write(tile,"png",new File(dir,names[i]+".png"));
    }
  }
}

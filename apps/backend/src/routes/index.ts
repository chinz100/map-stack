import { Router } from 'express';

import Paths from '@src/common/constants/Paths';
import UserRoutes from './UserRoutes';
import GeoRoutes from './GeoRoutes';


/******************************************************************************
                                Setup
******************************************************************************/

const apiRouter = Router();


// ** Users ** //
const userRouter = Router();
userRouter.get(Paths.Users.Get, UserRoutes.getAll);
userRouter.post(Paths.Users.Add, UserRoutes.add);
userRouter.put(Paths.Users.Update, UserRoutes.update);
userRouter.delete(Paths.Users.Delete, UserRoutes.delete);
apiRouter.use(Paths.Users.Base, userRouter);

// ** Geo data ** //
const geoRouter = Router();
geoRouter.get(Paths.Geo.Cities, GeoRoutes.getCitySummary);
geoRouter.get(Paths.Geo.Pois, GeoRoutes.getPois);
geoRouter.get(Paths.Geo.PoiClusters, GeoRoutes.getPoiClusters);
apiRouter.use(Paths.Geo.Base, geoRouter);


/******************************************************************************
                                Export default
******************************************************************************/

export default apiRouter;
